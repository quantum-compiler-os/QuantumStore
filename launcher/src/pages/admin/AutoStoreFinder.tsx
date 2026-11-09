import { useMemo, useRef, useState, type FormEvent } from 'react';
import { checkStore, discoverStores, type FoundShop, type StoreInfo } from '../../api/stores';
import { storeConfig } from '../../features/stores/storeConfig';
import { MARKUP_PKR, PLATFORM_NAME, rememberStore } from '../../features/stores/storeFetcher';
import SupplierSyncPage, { type AutoRun, type RunSummary } from '../../features/suppliers/SupplierSyncPage';
import { getErrorMessage } from '../../utils/errors';

type Candidate = FoundShop & { state: 'waiting' | 'checking' | 'ok' | 'refused'; note?: string };
type Shop = { host: string; name: string; info: StoreInfo };
type Row = Shop & { state: 'syncing' | 'done' | 'retry' | 'failed'; summary?: RunSummary; visits: number };

/** Shops checked at once while finding. */
const CHECK_PARALLEL = 4;
/**
 * The AI is asked again (leaving out every shop already tried) when too few of its shops can be read: many shops it
 * knows are not on Shopify or WooCommerce, so only some of each answer can be used.
 */
const FIND_ROUNDS = 3;
/** Tries per round for a shop whose catalog cannot be read (busy, rate limit…), a minute apart; later rounds try again. */
const SHOP_TRIES = 3;
const RETRY_SHOP_AFTER_S = 60;
/** Pause before the next round: short after one that added products, long when there was nothing to do. */
const NEXT_ROUND_AFTER_S = 60;
const IDLE_ROUND_AFTER_S = 15 * 60;
const MAX_CANDIDATES_SHOWN = 200;

const DONE_KEY = 'ql_store_finder_done';

/** Shops synced by the Auto finder, most recent first: new rounds look past them, refresh rounds go back to them. */
function syncedBefore(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(DONE_KEY) || '[]');
    return Array.isArray(list) ? list.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

function saveSyncedBefore(list: string[]) {
  try {
    localStorage.setItem(DONE_KEY, JSON.stringify(list.slice(0, 300)));
  } catch {
    /* private mode: remembering is a convenience only */
  }
}

function resultText(row: Row) {
  const { summary } = row;
  if (!summary) return '';
  if (summary.error) return row.state === 'retry' ? `${summary.error} — trying again in a minute` : `${summary.error} — tried again in a later round`;
  if (!summary.total) return 'Nothing new: already synced';
  const parts = [
    `${summary.handled} of ${summary.total} handled`,
    `${summary.created} new on QuantumStore`,
    `${summary.listed} on Daraz`,
    summary.darazFailed ? `${summary.darazFailed} Daraz failed` : '',
    summary.storeFailed ? `${summary.storeFailed} QuantumStore failed` : '',
    summary.noPicture ? `${summary.noPicture} without a working picture` : '',
    summary.leftForLater.length ? `no Daraz category for ${summary.leftForLater.join(', ')}` : '',
    summary.stopped ? 'stopped' : '',
  ];
  return parts.filter(Boolean).join(' · ');
}

const STATE_TEXT: Record<Row['state'], string> = { syncing: 'Syncing…', done: 'Done', retry: 'Waiting to retry', failed: 'Not readable yet' };

const minutes = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

export default function AutoStoreFinder() {
  const [focus, setFocus] = useState('');
  const [wanted, setWanted] = useState(5);
  const [perShop, setPerShop] = useState(50);
  const [keepGoing, setKeepGoing] = useState(true);
  const [running, setRunning] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [active, setActive] = useState<{ shop: Shop; key: string } | null>(null);
  const [status, setStatus] = useState('');
  const [wait, setWait] = useState<{ why: string; left: number } | null>(null);
  const [round, setRound] = useState(0);
  const [error, setError] = useState('');
  const [before, setBefore] = useState(syncedBefore);
  const controllerRef = useRef<AbortController | null>(null);
  const finishRef = useRef<((summary: RunSummary) => void) | null>(null);
  const perShopRef = useRef(perShop);
  const keepGoingRef = useRef(keepGoing);
  keepGoingRef.current = keepGoing;
  const visits = useRef(0);
  // Shop names as found, for shops that are visited again later (the check only knows their address).
  const names = useRef(new Map<string, string>());

  const updateCandidate = (host: string, change: Partial<Candidate>) =>
    setCandidates((prev) => prev.map((c) => (c.host === host ? { ...c, ...change } : c)));

  function upsertRow(shop: Shop, change: Partial<Row>) {
    setRows((prev) => {
      const at = prev.findIndex((r) => r.host === shop.host);
      if (at < 0) return [...prev, { ...shop, state: 'syncing', visits: 0, ...change }];
      return prev.map((r, i) => (i === at ? { ...r, ...change } : r));
    });
  }

  /** Waits `seconds`, counting down on the page; ends early when Stop is pressed. */
  async function pause(seconds: number, why: string, signal: AbortSignal) {
    for (let left = seconds; left > 0 && !signal.aborted; left -= 1) {
      setWait({ why, left });
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    setWait(null);
  }

  /** Mounts the sync page for one shop and resolves with what its run did. */
  function syncShop(shop: Shop) {
    return new Promise<RunSummary>((resolve) => {
      finishRef.current = resolve;
      visits.current += 1;
      setActive({ shop, key: `${shop.host}#${visits.current}` });
    });
  }

  /** Checks shops (4 at a time) until `need` of them can be read. */
  async function check(named: FoundShop[], need: number, signal: AbortSignal) {
    const found: Shop[] = [];
    for (let i = 0; i < named.length && found.length < need && !signal.aborted; i += CHECK_PARALLEL) {
      await Promise.all(
        named.slice(i, i + CHECK_PARALLEL).map(async (shop) => {
          updateCandidate(shop.host, { state: 'checking' });
          try {
            const info = await checkStore(shop.host);
            updateCandidate(shop.host, { state: 'ok', note: `${PLATFORM_NAME[info.platform]} · ${info.currency ?? 'PKR (not stated)'}` });
            if (shop.name !== shop.host) names.current.set(info.host, shop.name);
            found.push({ host: info.host, name: names.current.get(info.host) || shop.name, info });
          } catch (err) {
            updateCandidate(shop.host, { state: 'refused', note: getErrorMessage(err, 'Could not be read') });
          }
        }),
      );
    }
    return found.slice(0, need);
  }

  /** New shops: known ones that fit, then the AI's, each checked; `tried` collects every shop looked at this session. */
  async function findNew(signal: AbortSignal, tried: Set<string>) {
    const found: Shop[] = [];
    for (let attempt = 0; attempt < FIND_ROUNDS && found.length < wanted && !signal.aborted; attempt += 1) {
      let named: FoundShop[];
      try {
        named = (await discoverStores(focus, Math.min(40, Math.max(20, wanted * 4)), [...syncedBefore(), ...tried])).filter((s) => !tried.has(s.host));
      } catch (err) {
        setError(getErrorMessage(err, 'No new shops could be found'));
        break;
      }
      if (!named.length) break;
      for (const shop of named) tried.add(shop.host);
      setCandidates((prev) => [...prev, ...named.map((shop) => ({ ...shop, state: 'waiting' as const }))].slice(-MAX_CANDIDATES_SHOWN));
      found.push(...(await check(named, wanted - found.length, signal)));
    }
    return found;
  }

  /** Shops synced before (the longest ago first) and ones that could not be read: their remaining, new and changed products. */
  async function revisit(failed: Set<string>, signal: AbortSignal) {
    const hosts = [...new Set([...syncedBefore().reverse(), ...failed])];
    return check(hosts.map((host) => ({ host, name: names.current.get(host) || host, sells: '' })), wanted, signal);
  }

  function markSynced(shop: Shop) {
    const list = [shop.host, ...syncedBefore().filter((h) => h !== shop.host)];
    saveSyncedBefore(list);
    setBefore(list);
    rememberStore(shop.info.origin); // one click away on the Store fetcher page
  }

  /** Finds and syncs shops round after round until Stop is pressed (or once, with "keep going" off). */
  async function pilot(signal: AbortSignal) {
    const tried = new Set<string>();
    const failed = new Set<string>();
    for (let n = 1; !signal.aborted; n += 1) {
      setRound(n);
      setError('');
      setStatus('Finding new shops and checking each one…');
      let queue = await findNew(signal, tried);
      if (!queue.length && !signal.aborted) {
        setStatus('No new shops: going back to shops synced before for their remaining, new and changed products…');
        queue = await revisit(failed, signal);
      }
      let productive = false;
      const pending = queue.map((shop) => ({ shop, tries: 0, retryAt: 0 }));
      while (pending.length && !signal.aborted) {
        const next = pending.shift()!;
        const waitFor = Math.ceil((next.retryAt - Date.now()) / 1000);
        if (waitFor > 0) await pause(waitFor, `Trying ${next.shop.host} again`, signal);
        if (signal.aborted) break;
        setStatus(`Syncing ${next.shop.host}…`);
        upsertRow(next.shop, { state: 'syncing' });
        const summary = await syncShop(next.shop);
        setRows((prev) => prev.map((r) => (r.host === next.shop.host ? { ...r, visits: r.visits + 1 } : r)));
        if (summary.error) {
          // Busy, rate-limited or briefly offline: back of the queue, then a later round.
          const again = next.tries + 1 < SHOP_TRIES;
          upsertRow(next.shop, { state: again ? 'retry' : 'failed', summary });
          if (again) pending.push({ ...next, tries: next.tries + 1, retryAt: Date.now() + RETRY_SHOP_AFTER_S * 1000 });
          else failed.add(next.shop.host);
          continue;
        }
        failed.delete(next.shop.host);
        markSynced(next.shop);
        upsertRow(next.shop, { state: 'done', summary });
        if (summary.created + summary.listed > 0) productive = true;
      }
      if (signal.aborted || !keepGoingRef.current) break;
      setStatus(queue.length ? `Round ${n} done.` : 'No shops to sync yet.');
      await pause(productive ? NEXT_ROUND_AFTER_S : IDLE_ROUND_AFTER_S, productive ? 'Next round' : 'Nothing new to do: looking again', signal);
    }
  }

  async function start(e: FormEvent) {
    e.preventDefault();
    const controller = new AbortController();
    controllerRef.current = controller;
    perShopRef.current = perShop;
    setError('');
    setCandidates([]);
    setRows([]);
    setRunning(true);
    try {
      await pilot(controller.signal);
    } catch (err) {
      setError(getErrorMessage(err, err instanceof Error ? err.message : 'The Auto finder stopped unexpectedly'));
    }
    setWait(null);
    setStatus(controller.signal.aborted ? 'Stopped.' : 'Finished (keep going was off).');
    setRunning(false);
  }

  function stop() {
    controllerRef.current?.abort();
    setStatus('Stopping after the current product…');
  }

  function forgetSyncedBefore() {
    saveSyncedBefore([]);
    setBefore([]);
  }

  const shop = active?.shop;
  const config = useMemo(() => (shop ? storeConfig(shop.info.origin, shop.host) : null), [active?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  // One per visit, so the sync page starts once and always reports back (with Stop already pressed it reports at once);
  // the last page stays mounted afterwards to be read.
  const auto = useMemo<AutoRun | undefined>(() => {
    const controller = controllerRef.current;
    if (!active || !controller) return undefined;
    return {
      limit: perShopRef.current,
      signal: controller.signal,
      onDone: (summary) => {
        const finish = finishRef.current;
        finishRef.current = null;
        finish?.(summary);
      },
    };
  }, [active?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const totals = rows.reduce(
    (sum, r) => ({ created: sum.created + (r.summary?.created ?? 0), listed: sum.listed + (r.summary?.listed ?? 0) }),
    { created: 0, listed: 0 },
  );

  return (
    <div>
      <h1>Auto finder</h1>
      <p className="muted">
        Finds online shops and syncs them with no clicks, round after round until you press Stop: Pakistani shops that sell
        what you ask for come from a built-in list and from the AI, each one is checked (a Shopify or WooCommerce shop that
        prices in rupees), and its products go to QuantumStore at the shop&apos;s price + Rs {MARKUP_PKR} and to Daraz at that
        price plus Daraz&apos;s commission. A busy shop, a busy AI or broken picture storage is waited for and tried again,
        never given up on. When no new shops are left it goes back to the ones it synced for their remaining, new and changed
        products. Nothing is ever listed twice.
      </p>

      <form className="admin-quick" onSubmit={start} style={{ alignItems: 'flex-end', margin: '1rem 0' }}>
        <label style={{ display: 'grid', gap: '0.25rem', flex: '2 1 16rem' }}>
          What should the shops sell?
          <input
            className="input"
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
            placeholder="e.g. mobile accessories, books (empty: anything)"
            disabled={running}
            maxLength={120}
          />
        </label>
        <label style={{ display: 'grid', gap: '0.25rem', flex: '0 1 9rem' }}>
          Shops per round
          <input className="input" type="number" min={1} max={20} value={wanted} disabled={running} onChange={(e) => setWanted(Math.min(20, Math.max(1, Number(e.target.value) || 1)))} />
        </label>
        <label style={{ display: 'grid', gap: '0.25rem', flex: '0 1 11rem' }}>
          Products per shop (0 = all)
          <input className="input" type="number" min={0} max={5000} value={perShop} disabled={running} onChange={(e) => setPerShop(Math.min(5000, Math.max(0, Number(e.target.value) || 0)))} />
        </label>
        <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flex: '0 1 auto' }}>
          <input type="checkbox" checked={keepGoing} onChange={(e) => setKeepGoing(e.target.checked)} />
          Keep going until I press Stop
        </label>
        {!running ? (
          <button type="submit" className="btn btn-primary">
            Start
          </button>
        ) : (
          <button type="button" className="btn btn-secondary" onClick={stop} disabled={Boolean(controllerRef.current?.signal.aborted)}>
            Stop
          </button>
        )}
      </form>

      {before.length > 0 && (
        <p className="muted">
          {before.length} shop{before.length === 1 ? '' : 's'} synced so far: new rounds look past {before.length === 1 ? 'it' : 'them'}, and when no new shops are
          left the finder goes back to {before.length === 1 ? 'it' : 'them'}.{' '}
          <button type="button" className="btn btn-ghost" disabled={running} onClick={forgetSyncedBefore}>
            Forget them
          </button>
        </p>
      )}
      {(status || round > 0) && (
        <p className="muted" aria-live="polite">
          {round > 0 && <strong>Round {round}</strong>}
          {round > 0 && status ? ' · ' : ''}
          {status}
          {wait && ` ${wait.why}: ${minutes(wait.left)}`}
          {rows.length > 0 && ` · so far ${totals.created} new on QuantumStore, ${totals.listed} on Daraz`}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {rows.length > 0 && (
        <section aria-label="Shops" style={{ margin: '1rem 0' }}>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Shop</th>
                  <th>Status</th>
                  <th>Last visit</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.host}>
                    <td data-label="Shop">
                      <strong>{r.name}</strong>
                      <div className="muted">
                        {r.host} · {PLATFORM_NAME[r.info.platform]}
                        {r.visits > 1 ? ` · ${r.visits} visits` : ''}
                      </div>
                    </td>
                    <td data-label="Status">{STATE_TEXT[r.state]}</td>
                    <td data-label="Last visit">{resultText(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {candidates.length > 0 && (
        <details className="daraz-details" style={{ margin: '1rem 0' }}>
          <summary>
            <strong>Shops looked at</strong>{' '}
            <span className="muted">
              · {candidates.filter((c) => c.state === 'ok').length} can be read of {candidates.length}
            </span>
          </summary>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Shop</th>
                  <th>Sells</th>
                  <th>Check</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c, i) => (
                  <tr key={`${c.host}-${i}`}>
                    <td data-label="Shop">
                      <strong>{c.name}</strong>
                      <div className="muted">{c.host}</div>
                    </td>
                    <td data-label="Sells">{c.sells || '—'}</td>
                    <td data-label="Check">
                      <div className={`publish-step publish-step-${c.state === 'ok' ? 'done' : c.state === 'refused' ? 'failed' : 'running'}`}>
                        {c.state === 'ok' ? 'Can be read' : c.state === 'refused' ? 'Left out' : c.state === 'checking' ? 'Checking…' : 'Waiting'}
                        {c.note && <span className="muted"> · {c.note}</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {config && active && <SupplierSyncPage key={active.key} config={config} auto={auto} />}
    </div>
  );
}
