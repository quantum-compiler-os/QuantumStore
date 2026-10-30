import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getAudionicCatalog, saveAudionicLink, type AudionicItem } from '../../api/audionic';
import api from '../../api/client';
import {
  getDarazCategories,
  getDarazStatus,
  prepareDarazListing,
  publishToDaraz,
  suggestDarazCategories,
} from '../../api/daraz';
import { useConfirm } from '../../context/ConfirmContext';
import { useToast } from '../../context/ToastContext';
import {
  PAUSE_DARAZ_AFTER_BLOCKS,
  STOP_AFTER_FAILURES,
  consecutiveBlocked,
  adoptedLinks,
  consecutiveFailures,
  itemStatus,
  markSoldOut,
  removedLinks,
  syncItem,
  type ItemStatus,
  type SyncDeps,
  type SyncResult,
} from '../../features/audionic/syncOne';
import CategoryPicker from '../../features/daraz/CategoryPicker';
import { commissionFor, grossUpPrice, groupOf } from '../../features/daraz/categoryGroups';
import { ensureStoreCategory } from '../../features/products/ensureCategory';
import { queryKeys } from '../../hooks/queryKeys';
import { knownListingFor } from '../../../shared/knownListing';
import { usePkrRate } from '../../hooks/usePkrRate';
import { useAudionicProducts, useProductCategoryNames } from '../../hooks/useProducts';
import { getErrorMessage } from '../../utils/errors';

type TypeCategory = { id: number; path: string };
type LogLine = { time: string; level: 'info' | 'error'; text: string };

const MAX_LOG_LINES = 500;

const logAsText = (lines: LogLine[]) =>
  lines.map((l) => `${l.time} ${l.level === 'error' ? '[ERROR] ' : ''}${l.text}`).join('\n');

const CATEGORY_KEY = 'ql_audionic_categories';
const rs = (value: number) => `Rs ${value.toLocaleString()}`;

const STATUS_TEXT: Record<ItemStatus, string> = {
  new: 'New',
  changed: 'Changed',
  'daraz-missing': 'Not on Daraz',
  synced: 'Synced',
};

function loadSavedCategories(): Record<string, TypeCategory> {
  try {
    return JSON.parse(localStorage.getItem(CATEGORY_KEY) || '{}');
  } catch {
    return {};
  }
}

function ResultLine({ label, status, message }: { label: string; status: string; message?: string }) {
  return (
    <div className={`publish-step publish-step-${status}`}>
      <strong>{label}</strong> — {status}
      {message && <span className="muted"> · {message}</span>}
    </div>
  );
}

const STORE_STATUS: Record<SyncResult['store'], string> = {
  created: 'done',
  refreshed: 'done',
  unchanged: 'done',
  failed: 'failed',
};
const DARAZ_STATUS: Record<SyncResult['daraz'], string> = {
  listed: 'done',
  unchanged: 'done',
  skipped: 'skipped',
  failed: 'failed',
  blocked: 'failed',
};

export default function Audionic() {
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const { rate, ready: rateReady } = usePkrRate();
  const { data: storeCategories } = useProductCategoryNames();
  const [typeCategories, setTypeCategories] = useState<Record<string, TypeCategory>>(loadSavedCategories);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Record<string, SyncResult | 'running'>>({});
  const [running, setRunning] = useState(false);
  const [markingRemoved, setMarkingRemoved] = useState(false);
  const [notice, setNotice] = useState('');
  const [stage, setStage] = useState<Record<string, 'store' | 'daraz'>>({});
  const [suggesting, setSuggesting] = useState(false);
  const [suggestErrors, setSuggestErrors] = useState<Record<string, string>>({});
  const [log, setLog] = useState<LogLine[]>([]);
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const stopRef = useRef(false);
  const askedTypes = useRef(new Set<string>());

  const addLog = useCallback((text: string, level: 'info' | 'error' = 'info') => {
    setLog((prev) => [...prev.slice(-(MAX_LOG_LINES - 1)), { time: new Date().toLocaleTimeString(), level, text }]);
  }, []);
  useEffect(() => {
    logEndRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [log]);

  const catalog = useQuery({ queryKey: ['audionic', 'catalog'], queryFn: getAudionicCatalog, retry: false, refetchOnWindowFocus: false });
  const { data: status } = useQuery({ queryKey: ['daraz', 'status'], queryFn: getDarazStatus, retry: false });
  const darazReady = Boolean(status?.configured && status.connected);
  const leaves = useQuery({
    queryKey: ['daraz', 'categories'],
    queryFn: getDarazCategories,
    enabled: darazReady,
    staleTime: 60 * 60 * 1000,
    retry: false,
  });

  const items = catalog.data?.items;
  // Products the old backend sync imported are matched to their Audionic item (and repriced), never duplicated.
  const { data: backendAudionic } = useAudionicProducts();
  const savedLinks = catalog.data?.links;
  const adopted = useMemo(() => adoptedLinks(backendAudionic || [], savedLinks || []), [backendAudionic, savedLinks]);
  const links = useMemo(() => (savedLinks ? [...savedLinks, ...adopted] : undefined), [savedLinks, adopted]);
  const linkById = useMemo(() => new Map((links || []).map((l) => [l.audionicId, l])), [links]);
  const types = useMemo(() => [...new Set((items || []).map((i) => i.type))].sort(), [items]);
  const removed = useMemo(() => removedLinks(items || [], links || []), [items, links]);
  const statusOf = (item: AudionicItem) =>
    itemStatus(item, linkById.get(item.audionicId), { darazReady, hasCategory: Boolean(typeCategories[item.type]) });

  // Start with everything that needs syncing selected, including products that reached QuantumStore but not Daraz.
  useEffect(() => {
    if (!items) return;
    setSelected(
      new Set(
        items
          .filter((i) => itemStatus(i, linkById.get(i.audionicId), { darazReady, hasCategory: true }) !== 'synced')
          .map((i) => i.audionicId),
      ),
    );
  }, [items, linkById, darazReady]);

  function chooseCategory(type: string, leaf: TypeCategory) {
    setTypeCategories((prev) => {
      const next = { ...prev, [type]: { id: leaf.id, path: leaf.path } };
      try {
        localStorage.setItem(CATEGORY_KEY, JSON.stringify(next));
      } catch {
        /* private mode: remembering is a convenience only */
      }
      return next;
    });
  }

  // One type at a time (five at once trips Groq's rate limit); a failure is shown, not swallowed.
  async function suggestFor(typeNames: string[]) {
    if (!items) return;
    setSuggesting(true);
    for (const type of typeNames) {
      const sample = items.find((i) => i.type === type);
      if (!sample) continue;
      try {
        addLog(`AI: choosing a Daraz category for ${type}…`);
        const answer = await suggestDarazCategories({
          name: sample.name,
          brand: 'Audionic',
          description: sample.description.slice(0, 300),
        });
        const best = answer.suggestions[0];
        addLog(best ? `AI: ${type} → ${best.path}` : `AI: no category found for ${type}`, best ? 'info' : 'error');
        if (best) {
          setTypeCategories((prev) => (prev[type] ? prev : { ...prev, [type]: { id: best.id, path: best.path } }));
          setSuggestErrors((prev) => ({ ...prev, [type]: '' }));
        } else {
          setSuggestErrors((prev) => ({ ...prev, [type]: 'The AI found no matching category — choose one below.' }));
        }
      } catch (err) {
        addLog(`AI: could not choose a category for ${type} — ${getErrorMessage(err, 'unknown error')}`, 'error');
        setSuggestErrors((prev) => ({ ...prev, [type]: `${getErrorMessage(err, 'The AI could not suggest a category')} — choose one below.` }));
      }
    }
    setSuggesting(false);
  }

  // Ask the AI once for each type that has no remembered Daraz category.
  useEffect(() => {
    if (!darazReady || !status?.aiConfigured || !items) return;
    const pending = types.filter((type) => !typeCategories[type] && !askedTypes.current.has(type));
    if (!pending.length) return;
    for (const type of pending) askedTypes.current.add(type);
    void suggestFor(pending);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [darazReady, status?.aiConfigured, items, types]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectNeedingSync() {
    setSelected(new Set((items || []).filter((i) => statusOf(i) !== 'synced').map((i) => i.audionicId)));
  }

  const toSync = (items || []).filter((i) => selected.has(i.audionicId));
  // With Daraz connected, a product that can be listed there needs its type's Daraz category first.
  const typesWithoutCategory = darazReady
    ? [...new Set(toSync.filter((i) => i.available && !typeCategories[i.type]).map((i) => i.type))].sort()
    : [];

  function depsFor(item: AudionicItem, darazPausedReason?: string): SyncDeps {
    return {
      rate,
      daraz: { ready: darazReady, category: typeCategories[item.type] || null, pausedReason: darazPausedReason },
      ensureCategory: (name) => ensureStoreCategory(name, storeCategories || []),
      createProduct: async (payload) => (await api.post<{ _id: string }>('/products', payload)).data,
      updateProduct: async (id, payload) => {
        try {
          await api.put(`/products/${id}`, payload);
          return true;
        } catch (err) {
          if (axios.isAxiosError(err) && err.response?.status === 404) return false;
          throw err;
        }
      },
      prepareDaraz: prepareDarazListing,
      publishDaraz: publishToDaraz,
      saveLink: saveAudionicLink,
      onStage: (step) => setStage((prev) => ({ ...prev, [item.audionicId]: step })),
      log: addLog,
      knownListing: knownListingFor,
    };
  }

  async function run() {
    if (!toSync.length || running || typesWithoutCategory.length) return;
    if (!darazReady) {
      const goOn = await confirm(
        'Daraz is not connected, so these products will only be added to QuantumStore. Connect Daraz in Settings first if you want them there too.',
        { title: 'Sync to QuantumStore only?', confirmLabel: 'Only QuantumStore' },
      );
      if (!goOn) return;
    }
    setRunning(true);
    setNotice('');
    stopRef.current = false;
    addLog(
      `Starting: ${toSync.length} products · ${darazReady ? 'Daraz connected' : 'Daraz NOT connected (QuantumStore only)'} · ` +
        types.map((type) => `${type} → ${typeCategories[type]?.path || 'no category'}`).join(' | '),
    );
    const tally = { listed: 0, darazFailed: 0, darazSkipped: 0, darazBlocked: 0, storeFailed: 0 };
    let blocks = 0;
    let darazPausedReason: string | undefined;
    let done = 0;
    let storeFailures = 0;
    let darazFailures = 0;
    let haltedBecause = '';
    for (const item of toSync) {
      if (stopRef.current) break;
      setResults((prev) => ({ ...prev, [item.audionicId]: 'running' }));
      const result = await syncItem(item, linkById.get(item.audionicId), depsFor(item, darazPausedReason));
      setResults((prev) => ({ ...prev, [item.audionicId]: result }));
      done += 1;
      if (result.daraz === 'listed') tally.listed += 1;
      else if (result.daraz === 'failed') tally.darazFailed += 1;
      else if (result.daraz === 'blocked') tally.darazBlocked += 1;
      else if (result.daraz === 'skipped') tally.darazSkipped += 1;
      if (result.store === 'failed') tally.storeFailed += 1;
      addLog(`(${done}/${toSync.length}) done`);

      // Daraz keeps refusing the brand: stop asking it for the rest of this run, but keep filling QuantumStore.
      blocks = consecutiveBlocked(blocks, result);
      if (blocks >= PAUSE_DARAZ_AFTER_BLOCKS && !darazPausedReason) {
        darazPausedReason = `Daraz paused for this run: it refused the brand ${PAUSE_DARAZ_AFTER_BLOCKS} times in a row`;
        addLog(`${darazPausedReason}. The remaining products only go to QuantumStore.`, 'error');
      }

      // Do not repeat the same failure for every remaining product: stop and say what went wrong.
      storeFailures = consecutiveFailures(storeFailures, result, 'store');
      darazFailures = consecutiveFailures(darazFailures, result, 'daraz');
      if (storeFailures >= STOP_AFTER_FAILURES) haltedBecause = `QuantumStore refused ${STOP_AFTER_FAILURES} products in a row (${result.storeMessage})`;
      else if (darazFailures >= STOP_AFTER_FAILURES) haltedBecause = `Daraz refused ${STOP_AFTER_FAILURES} products in a row (${result.darazMessage})`;
      if (haltedBecause) break;
    }
    setRunning(false);
    addLog(
      `Finished${stopRef.current ? ' (stopped)' : ''}: ${done} of ${toSync.length} handled · on Daraz ${tally.listed} · Daraz failed ${tally.darazFailed} · Daraz skipped ${tally.darazSkipped} · Daraz brand not authorized ${tally.darazBlocked} · QuantumStore failed ${tally.storeFailed}`,
      tally.darazFailed || tally.storeFailed ? 'error' : 'info',
    );
    if (haltedBecause) {
      addLog(`Stopped early: ${haltedBecause}`, 'error');
      setNotice(`Stopped after ${done} of ${toSync.length}: ${haltedBecause}. Nothing is lost: products already created are remembered, so press Sync again after fixing it and only the rest is done.`);
    } else {
      toast.success(`${done} of ${toSync.length} products synced${stopRef.current ? ' (stopped)' : ''}`);
    }
    await Promise.all([catalog.refetch(), queryClient.invalidateQueries({ queryKey: queryKeys.products.all })]);
  }

  async function markRemovedSoldOut() {
    setMarkingRemoved(true);
    try {
      for (const link of removed) {
        await markSoldOut(link, async (id, stock) => void (await api.patch(`/products/${id}/stock`, { stock })), saveAudionicLink);
      }
      toast.success(`${removed.length} removed products marked sold out`);
      await Promise.all([catalog.refetch(), queryClient.invalidateQueries({ queryKey: queryKeys.products.all })]);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not mark the removed products sold out'));
    } finally {
      setMarkingRemoved(false);
    }
  }

  const counts = useMemo(() => {
    const tally: Record<ItemStatus, number> = { new: 0, changed: 0, 'daraz-missing': 0, synced: 0 };
    for (const item of items || []) tally[statusOf(item)] += 1;
    return tally;
  }, [items, linkById, darazReady, typeCategories]);

  return (
    <div>
      <h1>Audionic</h1>
      <p className="muted">
        Brings Audionic&apos;s catalog into QuantumStore and Daraz at Audionic&apos;s own prices. Daraz gets the price that
        still leaves Audionic&apos;s price after Daraz&apos;s commission. Items that are sold out stay on QuantumStore only.
      </p>

      <div className="admin-toolbar">
        <span className="muted">
          {catalog.isPending
            ? 'Reading audionic.co…'
            : items
              ? `${items.length} products · ${counts.new} new · ${counts.changed} changed · ${counts['daraz-missing']} not on Daraz · ${counts.synced} synced`
              : ''}
        </span>
        <div className="admin-quick">
          <button type="button" className="btn btn-ghost" disabled={catalog.isFetching || running} onClick={() => catalog.refetch()}>
            {catalog.isFetching ? 'Reading…' : 'Refresh from audionic.co'}
          </button>
          <button type="button" className="btn btn-ghost" disabled={running} onClick={selectNeedingSync}>
            Select what needs syncing
          </button>
        </div>
      </div>

      {adopted.length > 0 && (
        <p className="muted">
          {adopted.length} products already on QuantumStore came from the old Audionic import (listed Rs 100 below Audionic).
          Syncing them sets Audionic&apos;s exact price and lists them on Daraz; no copies are made.
        </p>
      )}
      {notice && (
        <p className="form-error" role="alert">
          {notice}
        </p>
      )}
      {catalog.isError && <p className="form-error">{getErrorMessage(catalog.error, 'Could not read audionic.co')}</p>}
      {!darazReady && status && (
        <p className="muted">Daraz is not connected, so products will go to QuantumStore only. Connect it in Settings.</p>
      )}

      {darazReady && types.length > 0 && (
        <section className="daraz-panel" aria-label="Daraz categories">
          <header className="daraz-head">
            <div>
              <h2>Daraz category for each type</h2>
              <p className="muted">
                Chosen once per type instead of per product. {status?.aiConfigured ? 'The AI suggests one; change it if it is wrong.' : 'Pick one for each type.'}
                {' '}Products only go to Daraz once their type has a category.
              </p>
            </div>
            {status?.aiConfigured && (
              <button
                type="button"
                className="btn btn-ghost"
                disabled={suggesting || running || types.every((type) => typeCategories[type])}
                onClick={() => suggestFor(types.filter((type) => !typeCategories[type]))}
              >
                {suggesting ? 'Asking the AI…' : 'Suggest the missing ones'}
              </button>
            )}
          </header>
          {types.map((type) => (
            <div key={type} className="daraz-section">
              <h3>{type}</h3>
              {suggestErrors[type] && !typeCategories[type] && <p className="form-error" style={{ margin: 0 }}>{suggestErrors[type]}</p>}
              <CategoryPicker
                leaves={leaves.data}
                loading={leaves.isLoading}
                error={leaves.error ? getErrorMessage(leaves.error, 'Could not load Daraz categories') : ''}
                selectedId={typeCategories[type]?.id ?? null}
                selectedPath={typeCategories[type]?.path ?? ''}
                onSelect={(leaf) => chooseCategory(type, leaf)}
              />
            </div>
          ))}
        </section>
      )}

      {removed.length > 0 && (
        <div className="admin-quick" style={{ alignItems: 'center', margin: '1rem 0' }}>
          <span className="muted">{removed.length} synced products are no longer listed by Audionic.</span>
          <button type="button" className="btn btn-secondary" disabled={markingRemoved || running} onClick={markRemovedSoldOut}>
            {markingRemoved ? 'Marking…' : 'Mark them sold out on QuantumStore'}
          </button>
        </div>
      )}

      {items && (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th className="col-check">
                  <input
                    type="checkbox"
                    checked={items.length > 0 && items.every((i) => selected.has(i.audionicId))}
                    onChange={() =>
                      setSelected(items.every((i) => selected.has(i.audionicId)) ? new Set() : new Set(items.map((i) => i.audionicId)))
                    }
                    aria-label="Select all products"
                  />
                </th>
                <th>Product</th>
                <th>Audionic price</th>
                <th>Daraz price</th>
                <th>Status</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const category = typeCategories[item.type];
                const commission = category ? commissionFor(groupOf(category.path)) : null;
                const result = results[item.audionicId];
                return (
                  <tr key={item.audionicId}>
                    <td data-label="Select" className="col-check">
                      <input
                        type="checkbox"
                        checked={selected.has(item.audionicId)}
                        disabled={running}
                        onChange={() => toggle(item.audionicId)}
                        aria-label={`Select ${item.name}`}
                      />
                    </td>
                    <td data-label="Product">
                      <div className="table-product">
                        <img src={item.thumbnail} alt="" width={40} height={40} loading="lazy" />
                        <div>
                          <strong>{item.name}</strong>
                          <div className="muted">
                            {item.type}
                            {item.available ? '' : ' · sold out'}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td data-label="Audionic price">{rs(item.pkr)}</td>
                    <td data-label="Daraz price">
                      {!item.available ? '—' : category ? rs(grossUpPrice(item.pkr, commission)) : 'pick a category'}
                    </td>
                    <td data-label="Status">{STATUS_TEXT[statusOf(item)]}</td>
                    <td data-label="Result">
                      {result === 'running' && (
                        <span className="muted">{stage[item.audionicId] === 'daraz' ? 'QuantumStore done · sending to Daraz…' : 'Sending to QuantumStore…'}</span>
                      )}
                      {result && result !== 'running' && (
                        <>
                          <ResultLine label="QuantumStore" status={STORE_STATUS[result.store]} message={result.storeMessage || (result.store === 'created' ? 'created' : result.store === 'refreshed' ? 'refreshed' : undefined)} />
                          <ResultLine label="Daraz" status={DARAZ_STATUS[result.daraz]} message={result.darazMessage} />
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <details className="daraz-details" open style={{ margin: '1rem 0' }}>
        <summary>
          <strong>Log</strong> <span className="muted">· every step, including each Daraz attempt ({log.length})</span>
        </summary>
        <div style={{ padding: 'var(--space-3) var(--space-4)', display: 'grid', gap: 'var(--space-3)' }}>
          <div className="admin-quick">
            <button
              type="button"
              className="btn btn-ghost"
              disabled={!log.length}
              onClick={() => void navigator.clipboard?.writeText(logAsText(log))}
            >
              Copy log
            </button>
            <button type="button" className="btn btn-ghost" disabled={!log.length || running} onClick={() => setLog([])}>
              Clear
            </button>
          </div>
          <div
            role="log"
            aria-live="polite"
            style={{ maxHeight: '18rem', overflow: 'auto', fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '0.8rem', lineHeight: 1.5 }}
          >
            {log.length === 0 && <span className="muted">Nothing yet — press Sync and every step shows up here.</span>}
            {log.map((line, index) => (
              <div key={index} style={line.level === 'error' ? { color: 'var(--danger, #dc2626)' } : undefined}>
                <span className="muted">{line.time}</span> {line.text}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        </div>
      </details>

      <div className="publish-bar">
        {typesWithoutCategory.length > 0 && (
          <p className="form-error" role="alert" style={{ margin: 0 }}>
            {suggesting
              ? 'Choosing Daraz categories…'
              : `Choose a Daraz category for ${typesWithoutCategory.join(', ')} above, so these products go to Daraz as well as QuantumStore.`}
          </p>
        )}
        <div className="admin-quick">
          {!running ? (
            <button type="button" className="btn btn-primary" disabled={!toSync.length || !rateReady || typesWithoutCategory.length > 0} onClick={run}>
              {toSync.length === (items || []).length ? `Sync everything (${toSync.length})` : `Sync selected (${toSync.length})`}
            </button>
          ) : (
            <button type="button" className="btn btn-secondary" onClick={() => (stopRef.current = true)}>
              Stop after this product
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
