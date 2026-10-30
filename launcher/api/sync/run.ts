import { requireOwner } from '../_lib/auth.js';
import { HttpError, route } from '../_lib/http.js';
import { realSyncDeps } from '../_lib/syncDeps.js';
import { finishRun, logSync, startRun } from '../_lib/syncState.js';
import { runSync, type SyncReport } from '../_lib/syncRun.js';

/**
 * Runs the sync: Daraz items missing from QuantumStore are imported, QuantumStore products missing from Daraz are
 * listed, and products deleted on one side are removed from the other only when `applyRemovals` is true.
 * Progress is readable from /sync/log while this request is still running.
 */
export default route('POST', async (req, res) => {
  await requireOwner(req);
  const applyRemovals = Boolean((req.body as { applyRemovals?: unknown } | undefined)?.applyRemovals);
  if (!startRun()) throw new HttpError(409, 'A sync is already running — wait for it to finish');

  let report: SyncReport | null = null;
  try {
    logSync(applyRemovals ? 'Sync started (removals ON)' : 'Sync started (removals only previewed)');
    report = await runSync(realSyncDeps(String(req.headers.authorization), logSync), { applyRemovals });
  } catch (err) {
    logSync(`Sync stopped: ${err instanceof Error ? err.message : err}`);
    throw err;
  } finally {
    finishRun(report);
  }
  res.status(200).json({ ok: true, report });
});
