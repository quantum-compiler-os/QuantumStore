#!/usr/bin/env node
/**
 * Syncs QuantumStore and Daraz from the terminal: the same run as the Launcher's Sync page.
 *
 *   npm run sync                 imports/lists/links what is missing; only PREVIEWS removals
 *   npm run sync -- --apply      also removes products that were deleted on one side from the other
 *   npm run sync -- --check      only shows what would change
 *   npm run sync -- --url http://127.0.0.1:5174   if the Launcher runs somewhere else
 *
 * It talks to the running Launcher (`npm run dev`), which holds the Daraz and database credentials, and signs in with the
 * owner auto sign-in from launcher/.env (LAUNCHER_AUTO_LOGIN_EMAIL / _PASSWORD).
 */
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const urlIndex = args.indexOf('--url');
const base = (urlIndex >= 0 ? args[urlIndex + 1] : 'http://127.0.0.1:5174').replace(/\/$/, '') + '/launcher-api';
const apply = flag('--apply');
const checkOnly = flag('--check');

function die(message) {
  console.error(`\n${message}`);
  process.exit(1);
}

async function call(path, { token, method = 'GET', body } = {}) {
  let response;
  try {
    const init = { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) } };
    if (body) init.body = JSON.stringify(body);
    response = await fetch(`${base}${path}`, init);
  } catch {
    die(`Could not reach the Launcher at ${base}. Start it first (npm run dev in the launcher folder).`);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) die(`${method} ${path} failed (HTTP ${response.status}): ${data.message || 'no message'}`);
  return data;
}

const { token } = await call('/session');
if (!token) die('The Launcher gave no session. Set LAUNCHER_AUTO_LOGIN_EMAIL and LAUNCHER_AUTO_LOGIN_PASSWORD in launcher/.env.');

if (checkOnly) {
  const { preview } = await call('/sync/scan', { token });
  if (preview.problem) die(preview.problem);
  const show = (title, names) => names.length && console.log(`\n${title} (${names.length}):\n  ${names.join('\n  ')}`);
  show('Import from Daraz', preview.importToStore);
  show('List on Daraz', preview.listOnDaraz);
  show('Link (already on both)', preview.link);
  show('Remove from Daraz (deleted on QuantumStore)', preview.removeFromDaraz);
  show('Remove from QuantumStore (deleted on Daraz)', preview.removeFromStore);
  console.log('\nNothing was changed.');
  process.exit(0);
}

console.log(apply ? 'Syncing (removals ON)…' : 'Syncing (removals are only previewed; add --apply to do them)…');

let since = 0;
let stop = false;
const printLog = async () => {
  const data = await call(`/sync/log?since=${since}`, { token }).catch(() => null);
  if (!data) return;
  since = data.next;
  for (const line of data.lines) console.log(line);
};
const poller = (async () => {
  while (!stop) {
    await printLog();
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
})();

let result;
try {
  const response = await fetch(`${base}/sync/run`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ applyRemovals: apply }),
  });
  result = { ok: response.ok, status: response.status, data: await response.json().catch(() => ({})) };
} catch {
  stop = true;
  await poller;
  die('The connection to the Launcher dropped while syncing. Check its terminal; the run may still be going.');
}
stop = true;
await poller;
await printLog();

if (!result.ok) die(`The sync failed (HTTP ${result.status}): ${result.data.message || 'no message'}`);
const report = result.data.report;
if (report.problem) die(report.problem);

console.log(
  `\nImported ${report.imported.length}, listed ${report.listed.length}, linked ${report.linked.length}, ` +
    `removed ${report.removedFromDaraz.length + report.removedFromStore.length}, problems ${report.failures.length}.`,
);
const waiting = report.pendingRemovals.fromDaraz.length + report.pendingRemovals.fromStore.length;
if (waiting) {
  console.log(
    report.pendingRemovals.blocked
      ? `\nRemovals NOT applied: ${report.pendingRemovals.blocked}`
      : `\n${waiting} removals are waiting. Run \`npm run sync -- --apply\` to carry them out:\n  ${[...report.pendingRemovals.fromDaraz.map((n) => `off Daraz: ${n}`), ...report.pendingRemovals.fromStore.map((n) => `off QuantumStore: ${n}`)].join('\n  ')}`,
  );
}
for (const failure of report.failures) console.log(`! ${failure.action}: ${failure.name} — ${failure.reason}`);
process.exit(report.failures.length ? 2 : 0);
