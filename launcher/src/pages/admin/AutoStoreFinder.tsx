import { useMemo, useRef, useState, type FormEvent } from 'react';
import { checkStore, discoverStores, type FoundShop, type StoreInfo } from '../../api/stores';
import { storeConfig } from '../../features/stores/storeConfig';
import { MARKUP_PKR, PLATFORM_NAME, rememberStore } from '../../features/stores/storeFetcher';
import SupplierSyncPage, { type AutoRun, type RunSummary } from '../../features/suppliers/SupplierSyncPage';
import { getErrorMessage } from '../../utils/errors';

type Candidate = FoundShop & { state: 'waiting' | 'checking' | 'ok' | 'refused'; note?: string };
type QueuedShop = { host: string; name: string; info: StoreInfo; state: 'waiting' | 'syncing' | 'done' | 'failed'; summary?: RunSummary };
type Phase = 'idle' | 'finding' | 'syncing' | 'done';

/** Shops checked at once while finding. */
const CHECK_PARALLEL = 4;
/**
 * The AI is asked again (leaving out every shop already tried) when too few of its shops can be read: many shops it
 * knows are not on Shopify or WooCommerce, so only some of each answer can be used.
 */
const FIND_ROUNDS = 3;

const DONE_KEY = 'ql_store_finder_done';

/** Shops an earlier Auto finder run synced: left out when finding, so each run brings in new shops. */
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

function resultText(summary: RunSummary | undefined) {
  if (!summary) return '';
  if (summary.error) return summary.error;
  if (!summary.total) return 'Nothing new: already synced';
  const parts = [
    `${summary.handled} of ${summary.total} handled`,
    `${summary.listed} on Daraz`,
    summary.darazFailed ? `${summary.darazFailed} Daraz failed` : '',
    summary.storeFailed ? `${summary.storeFailed} QuantumStore failed` : '',
    summary.noPicture ? `${summary.noPicture} without a working picture` : '',
    summary.leftForLater.length ? `no Daraz category for ${summary.leftForLater.join(', ')}` : '',
    summary.stopReason || (summary.stopped ? 'stopped' : ''),
  ];
  return parts.filter(Boolean).join(' · ');
}

const STATE_TEXT: Record<QueuedShop['state'], string> = { waiting: 'Waiting', syncing: 'Syncing…', done: 'Done', failed: 'Failed' };

export default function AutoStoreFinder() {
  const [focus, setFocus] = useState('');
  const [wanted, setWanted] = useState(5);
  const [perShop, setPerShop] = useState(50);
  const [phase, setPhase] = useState<Phase>('idle');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [shops, setShops] = useState<QueuedShop[]>([]);
  const [current, setCurrent] = useState(0);
  const [error, setError] = useState('');
  const [halted, setHalted] = useState('');
  const [before, setBefore] = useState(syncedBefore);
  const controllerRef = useRef<AbortController | null>(null);
  const shopsRef = useRef<QueuedShop[]>([]);
  const perShopRef = useRef(perShop);

  const updateCandidate = (host: string, change: Partial<Candidate>) =>
    setCandidates((prev) => prev.map((c) => (c.host === host ? { ...c, ...change } : c)));

  /** Asks the AI for shops and checks each one, until `wanted` shops can be read (or the AI runs out of names). */
  async function find(signal: AbortSignal) {
    const tried = new Set(syncedBefore());
    const found: QueuedShop[] = [];
    for (let round = 0; round < FIND_ROUNDS && found.length < wanted && !signal.aborted; round += 1) {
      let named: FoundShop[];
      try {
        named = (await discoverStores(focus, Math.min(40, Math.max(20, wanted * 4)), [...tried])).filter((shop) => !tried.has(shop.host));
      } catch (err) {
        if (round === 0) throw err;
        break;
      }
      if (!named.length) break;
      for (const shop of named) tried.add(shop.host);
      setCandidates((prev) => [...prev, ...named.map((shop) => ({ ...shop, state: 'waiting' as const }))]);
      for (let i = 0; i < named.length && found.length < wanted && !signal.aborted; i += CHECK_PARALLEL) {
        await Promise.all(
          named.slice(i, i + CHECK_PARALLEL).map(async (shop) => {
            updateCandidate(shop.host, { state: 'checking' });
            try {
              const info = await checkStore(shop.host);
              updateCandidate(shop.host, { state: 'ok', note: `${PLATFORM_NAME[info.platform]} · ${info.currency ?? 'PKR (not stated)'}` });
              found.push({ host: info.host, name: shop.name, info, state: 'waiting' });
            } catch (err) {
              updateCandidate(shop.host, { state: 'refused', note: getErrorMessage(err, 'Could not be read') });
            }
          }),
        );
      }
    }
    return found.slice(0, wanted);
  }

  async function start(e: FormEvent) {
    e.preventDefault();
    const controller = new AbortController();
    controllerRef.current = controller;
    perShopRef.current = perShop;
    setError('');
    setHalted('');
    setCandidates([]);
    setShops([]);
    shopsRef.current = [];
    setCurrent(0);
    setPhase('finding');
    let queue: QueuedShop[];
    try {
      queue = await find(controller.signal);
    } catch (err) {
      setError(getErrorMessage(err, 'No shops could be found — try again'));
      setPhase('idle');
      return;
    }
    if (controller.signal.aborted) {
      setHalted('Stopped while finding shops.');
      setPhase('done');
      return;
    }
    if (!queue.length) {
      setError('None of the shops found can be read (not Shopify or WooCommerce, not in rupees, or offline). Try other words.');
      setPhase('idle');
      return;
    }
    queue[0] = { ...queue[0], state: 'syncing' };
    shopsRef.current = queue;
    setShops(queue);
    setPhase('syncing');
  }

  function finishShop(index: number, summary: RunSummary) {
    const shop = shopsRef.current[index];
    if (!shop) return;
    if (!summary.error) {
      const list = [shop.host, ...syncedBefore().filter((h) => h !== shop.host)];
      saveSyncedBefore(list);
      setBefore(list);
      rememberStore(shop.info.origin); // so it is one click away on the Store fetcher page
    }
    const halt = summary.stopReason || (summary.stopped || controllerRef.current?.signal.aborted ? 'Stopped.' : '');
    const next = !halt && index + 1 < shopsRef.current.length ? index + 1 : -1;
    shopsRef.current = shopsRef.current.map((s, i) => {
      if (i === index) return { ...s, state: summary.error ? 'failed' : 'done', summary };
      if (i === next) return { ...s, state: 'syncing' };
      return s;
    });
    setShops(shopsRef.current);
    if (halt) setHalted(halt);
    if (next >= 0) setCurrent(next);
    else setPhase('done');
  }

  function stop() {
    controllerRef.current?.abort();
  }

  function forgetSyncedBefore() {
    saveSyncedBefore([]);
    setBefore([]);
  }

  const shop = shops[current];
  const config = useMemo(() => (shop ? storeConfig(shop.info.origin, shop.host) : null), [shop?.host]); // eslint-disable-line react-hooks/exhaustive-deps
  // One per shop, so the sync page starts once for it; null when not syncing (the last shop's page stays to read).
  const auto = useMemo<AutoRun | undefined>(() => {
    const controller = controllerRef.current;
    if (phase !== 'syncing' || !controller) return undefined;
    return { limit: perShopRef.current, signal: controller.signal, onDone: (summary) => finishShop(current, summary) };
  }, [phase, current]); // eslint-disable-line react-hooks/exhaustive-deps

  const busy = phase === 'finding' || phase === 'syncing';
  const totals = shops.reduce(
    (sum, s) => ({ handled: sum.handled + (s.summary?.handled ?? 0), listed: sum.listed + (s.summary?.listed ?? 0) }),
    { handled: 0, listed: 0 },
  );

  return (
    <div>
      <h1>Auto finder</h1>
      <p className="muted">
        Finds online shops for you and syncs them, one after another, with no clicks: Pakistani shops that sell what you ask
        for are taken from a built-in list and from the AI, each one is checked (a Shopify or WooCommerce shop that prices in
        rupees), and its products go to
        QuantumStore at the shop&apos;s price + Rs {MARKUP_PKR} and to Daraz at that price plus Daraz&apos;s commission, with
        Daraz categories chosen by the AI. Products already synced are never listed twice.
      </p>

      <form className="admin-quick" onSubmit={start} style={{ alignItems: 'flex-end', margin: '1rem 0' }}>
        <label style={{ display: 'grid', gap: '0.25rem', flex: '2 1 16rem' }}>
          What should the shops sell?
          <input
            className="input"
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
            placeholder="e.g. mobile accessories, books (empty: anything)"
            disabled={busy}
            maxLength={120}
          />
        </label>
        <label style={{ display: 'grid', gap: '0.25rem', flex: '0 1 8rem' }}>
          Shops
          <input className="input" type="number" min={1} max={20} value={wanted} disabled={busy} onChange={(e) => setWanted(Math.min(20, Math.max(1, Number(e.target.value) || 1)))} />
        </label>
        <label style={{ display: 'grid', gap: '0.25rem', flex: '0 1 11rem' }}>
          Products per shop (0 = all)
          <input className="input" type="number" min={0} max={5000} value={perShop} disabled={busy} onChange={(e) => setPerShop(Math.min(5000, Math.max(0, Number(e.target.value) || 0)))} />
        </label>
        {!busy ? (
          <button type="submit" className="btn btn-primary">
            Find shops and sync
          </button>
        ) : (
          <button type="button" className="btn btn-secondary" onClick={stop}>
            Stop after this product
          </button>
        )}
      </form>

      {before.length > 0 && (
        <p className="muted">
          {before.length} shop{before.length === 1 ? '' : 's'} synced by earlier runs {before.length === 1 ? 'is' : 'are'} left out when finding, so each run
          brings in new ones (refresh them on the Store fetcher page).{' '}
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={forgetSyncedBefore}>
            Include them again
          </button>
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {phase === 'finding' && <p className="muted">Finding shops and checking each one…</p>}

      {candidates.length > 0 && (
        <details className="daraz-details" open={phase === 'finding'} style={{ margin: '1rem 0' }}>
          <summary>
            <strong>Shops found</strong>{' '}
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
                {candidates.map((c) => (
                  <tr key={c.host}>
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

      {shops.length > 0 && (
        <section aria-label="Shops being synced" style={{ margin: '1rem 0' }}>
          <h2>
            Syncing {shops.length} shop{shops.length === 1 ? '' : 's'}
            {phase === 'done' && <span className="muted"> · finished: {totals.handled} products handled, {totals.listed} on Daraz</span>}
          </h2>
          {halted && (
            <p className="form-error" role="alert">
              {halted}
            </p>
          )}
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Shop</th>
                  <th>Status</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {shops.map((s) => (
                  <tr key={s.host}>
                    <td data-label="Shop">
                      <strong>{s.name}</strong>
                      <div className="muted">
                        {s.host} · {PLATFORM_NAME[s.info.platform]}
                      </div>
                    </td>
                    <td data-label="Status">{STATE_TEXT[s.state]}</td>
                    <td data-label="Result">{resultText(s.summary)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {config && shop && <SupplierSyncPage key={shop.host} config={config} auto={auto} />}
    </div>
  );
}
