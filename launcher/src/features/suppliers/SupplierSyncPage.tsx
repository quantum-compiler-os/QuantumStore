import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import axios from 'axios';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../api/client';
import {
  getDarazCategories,
  getDarazStatus,
  prepareDarazListing,
  publishToDaraz,
  suggestDarazCategories,
  terminalCountdown,
  type DarazCategoryLeaf,
} from '../../api/daraz';
import { useConfirm } from '../../context/ConfirmContext';
import { useToast } from '../../context/ToastContext';
import {
  PAUSE_DARAZ_AFTER_BLOCKS,
  STOP_AFTER_FAILURES,
  consecutiveBlocked,
  consecutiveFailures,
  itemStatus,
  markSoldOut,
  syncItem,
  type ItemStatus,
  type Pictures,
  type SourceItem,
  type SourceLink,
  type SyncDeps,
  type SyncResult,
  type SyncSource,
} from '../audionic/syncOne';
import CategoryPicker from '../daraz/CategoryPicker';
import { commissionFor, grossUpPrice, groupOf } from '../daraz/categoryGroups';
import { ensureStoreCategory } from '../products/ensureCategory';
import { queryKeys } from '../../hooks/queryKeys';
import { usePkrRate } from '../../hooks/usePkrRate';
import { useProductCategoryNames } from '../../hooks/useProducts';
import { getErrorMessage } from '../../utils/errors';
import type { KnownListing } from '../../../shared/knownListing';

export type TypeCategory = { id: number; path: string };

/** A saved link with the supplier's product id under one name, whatever the supplier calls it. */
export type SupplierLinkRow = SourceLink & { id: string };

/** Everything that differs between suppliers (Audionic, CamSham…); the page itself is the same. */
export type SupplierConfig<I extends SourceItem> = {
  /** "Audionic" — used in headings, messages and column titles. */
  name: string;
  /** "audionic.co" — where the catalog is read from. */
  site: string;
  intro: ReactNode;
  /** localStorage key for the Daraz category chosen per type. */
  categoryStorageKey: string;
  fetchCatalog: () => Promise<{ items: I[]; links: SupplierLinkRow[] }>;
  idOf: (item: I) => string;
  sourceFor: (item: I) => SyncSource;
  saveLink: (link: SupplierLinkRow) => Promise<void>;
  /** The line under the product name in the table. */
  describe: (item: I) => string;
  /** A hand-picked Daraz category for a type, used while the AI cannot answer. */
  fallbackCategory?: (type: string, leaves: DarazCategoryLeaf[]) => DarazCategoryLeaf | null;
  /** Use the hand-picked category first and only ask the AI for types it has none for (saves Groq requests). */
  builtInFirst?: boolean;
  /** The QuantumStore category, given the Daraz category chosen for the item's type (if any). */
  storeCategory?: (item: I, daraz: TypeCategory | null) => string;
  /** Copies the supplier's pictures to our own storage before the product is listed. */
  hostImages?: (item: I, log: (text: string, level?: 'info' | 'error') => void) => Promise<Pictures>;
  knownListing?: (id: string) => KnownListing | undefined;
};

type LogLine = { time: string; level: 'info' | 'error'; text: string };

const MAX_LOG_LINES = 500;

/**
 * When the AI (Groq) cannot answer for a while — its rate limit, or the connection to it failing (e.g. a DNS hiccup) —
 * the product waits this long (seconds) and tries again, until it goes through or Stop is pressed.
 */
const RATE_LIMIT_WAIT = 60;

/** Why Groq could not answer, when that is something a short wait fixes; otherwise null. */
function aiUnavailable(result: SyncResult) {
  if (result.daraz !== 'failed') return null;
  const message = result.darazMessage || '';
  if (/rate limit/i.test(message)) return 'Groq rate limit';
  if (/could not reach groq|groq did not answer/i.test(message)) return 'Groq unreachable';
  return null;
}

const logAsText = (lines: LogLine[]) =>
  lines.map((l) => `${l.time} ${l.level === 'error' ? '[ERROR] ' : ''}${l.text}`).join('\n');

const rs = (value: number) => `Rs ${value.toLocaleString()}`;

const STATUS_TEXT: Record<ItemStatus, string> = {
  new: 'New',
  changed: 'Changed',
  'daraz-missing': 'Not on Daraz',
  synced: 'Synced',
};

function loadSavedCategories(key: string): Record<string, TypeCategory> {
  try {
    return JSON.parse(localStorage.getItem(key) || '{}');
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
  skipped: 'skipped',
  failed: 'failed',
};
const DARAZ_STATUS: Record<SyncResult['daraz'], string> = {
  listed: 'done',
  unchanged: 'done',
  skipped: 'skipped',
  failed: 'failed',
  blocked: 'failed',
};

type Props<I extends SourceItem> = {
  config: SupplierConfig<I>;
  /** Extra links for products an older import created (they are adopted instead of duplicated). */
  adopt?: (saved: SupplierLinkRow[]) => SupplierLinkRow[];
  adoptedNotice?: (count: number) => ReactNode;
};

export default function SupplierSyncPage<I extends SourceItem>({ config, adopt, adoptedNotice }: Props<I>) {
  const { name, site, idOf } = config;
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const { rate, ready: rateReady } = usePkrRate();
  const { data: storeCategories } = useProductCategoryNames();
  const [typeCategories, setTypeCategories] = useState<Record<string, TypeCategory>>(() => loadSavedCategories(config.categoryStorageKey));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Record<string, SyncResult | 'running'>>({});
  const [running, setRunning] = useState(false);
  const [markingRemoved, setMarkingRemoved] = useState(false);
  const [notice, setNotice] = useState('');
  const [stage, setStage] = useState<Record<string, 'store' | 'daraz'>>({});
  const [suggesting, setSuggesting] = useState(false);
  const [suggestErrors, setSuggestErrors] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [log, setLog] = useState<LogLine[]>([]);
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const stopRef = useRef(false);
  const askedTypes = useRef(new Set<string>());
  // A run reads these as it goes, so categories the AI picks (or you change) during the run are used straight away.
  const categoriesRef = useRef(typeCategories);
  categoriesRef.current = typeCategories;
  const suggestingRef = useRef(false);
  // Links saved since the catalog was read, so retrying a product never creates it on QuantumStore a second time.
  const freshLinks = useRef(new Map<string, SupplierLinkRow>());
  // Seconds left before a product held up by Groq's rate limit is tried again (shown live at the end of the log).
  const [countdown, setCountdown] = useState<{ why: string; left: number } | null>(null);

  const addLog = useCallback((text: string, level: 'info' | 'error' = 'info') => {
    setLog((prev) => [...prev.slice(-(MAX_LOG_LINES - 1)), { time: new Date().toLocaleTimeString(), level, text }]);
  }, []);
  const counting = countdown !== null;
  useEffect(() => {
    logEndRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [log, counting]);

  const catalog = useQuery({
    queryKey: ['supplier', name, 'catalog'],
    queryFn: config.fetchCatalog,
    retry: false,
    refetchOnWindowFocus: false,
  });
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
  const savedLinks = catalog.data?.links;
  const adopted = useMemo(() => (adopt && savedLinks ? adopt(savedLinks) : []), [adopt, savedLinks]);
  const links = useMemo(() => (savedLinks ? [...savedLinks, ...adopted] : undefined), [savedLinks, adopted]);
  const linkById = useMemo(() => new Map((links || []).map((l) => [l.id, l])), [links]);
  const types = useMemo(() => [...new Set((items || []).map((i) => i.type))].sort(), [items]);
  const removed = useMemo(() => {
    const live = new Set((items || []).map(idOf));
    return (links || []).filter((link) => link.available && !live.has(link.id));
  }, [items, links, idOf]);
  const statusOf = (item: I) =>
    itemStatus(item, linkById.get(idOf(item)), { darazReady, hasCategory: Boolean(typeCategories[item.type]) });

  const shown = useMemo(() => {
    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return items || [];
    return (items || []).filter((item) => {
      const text = `${item.name} ${config.describe(item)}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
  }, [items, search, config]);

  // Start with everything that needs syncing selected, including products that reached QuantumStore but not Daraz.
  useEffect(() => {
    if (!items) return;
    setSelected(
      new Set(
        items
          .filter((i) => itemStatus(i, linkById.get(idOf(i)), { darazReady, hasCategory: true }) !== 'synced')
          .map(idOf),
      ),
    );
  }, [items, linkById, darazReady, idOf]);

  function chooseCategory(type: string, leaf: TypeCategory) {
    setTypeCategories((prev) => {
      const next = { ...prev, [type]: { id: leaf.id, path: leaf.path } };
      try {
        localStorage.setItem(config.categoryStorageKey, JSON.stringify(next));
      } catch {
        /* private mode: remembering is a convenience only */
      }
      return next;
    });
  }

  /** The built-in category for a type, once Daraz's category list is loaded. */
  async function builtInCategory(type: string) {
    if (!config.fallbackCategory) return null;
    try {
      const list = leaves.data ?? (await leaves.refetch()).data;
      return list ? config.fallbackCategory(type, list) : null;
    } catch {
      return null;
    }
  }

  function applyBuiltIn(type: string, fallback: DarazCategoryLeaf) {
    addLog(`Built-in choice: ${type} → ${fallback.path} (change it below if it is wrong)`);
    categoriesRef.current = categoriesRef.current[type] ? categoriesRef.current : { ...categoriesRef.current, [type]: { id: fallback.id, path: fallback.path } };
    setTypeCategories((prev) => (prev[type] ? prev : { ...prev, [type]: { id: fallback.id, path: fallback.path } }));
    setSuggestErrors((prev) => ({ ...prev, [type]: '' }));
  }

  // One type at a time (five at once trips Groq's rate limit); a failure is shown, not swallowed.
  async function suggestFor(typeNames: string[]) {
    if (!items) return;
    setSuggesting(true);
    suggestingRef.current = true;
    for (const type of typeNames) {
      const samples = items.filter((i) => i.type === type);
      const sample = samples[0];
      if (!sample) continue;
      // A few names of the type, so one odd product does not decide the category for all of them.
      const examples = samples.slice(0, 5).map((i) => i.name).join('; ');
      if (config.builtInFirst || !status?.aiConfigured) {
        const builtIn = await builtInCategory(type);
        if (builtIn) {
          applyBuiltIn(type, builtIn);
          continue;
        }
        if (!status?.aiConfigured) {
          setSuggestErrors((prev) => ({ ...prev, [type]: 'No built-in category for this type — choose one below.' }));
          continue;
        }
      }
      try {
        addLog(`AI: choosing a Daraz category for ${type}…`);
        const answer = await suggestDarazCategories({
          name: sample.name,
          brand: config.sourceFor(sample).brand,
          description: `Product type: ${type}. Examples: ${examples}. ${sample.description.slice(0, 200)}`,
        });
        const best = answer.suggestions[0];
        addLog(best ? `AI: ${type} → ${best.path}` : `AI: no category found for ${type}`, best ? 'info' : 'error');
        if (best) {
          setTypeCategories((prev) => (prev[type] ? prev : { ...prev, [type]: { id: best.id, path: best.path } }));
          setSuggestErrors((prev) => ({ ...prev, [type]: '' }));
        } else {
          const fallback = await builtInCategory(type);
          if (fallback) applyBuiltIn(type, fallback);
          else setSuggestErrors((prev) => ({ ...prev, [type]: 'The AI found no matching category — choose one below.' }));
        }
      } catch (err) {
        addLog(`AI: could not choose a category for ${type} — ${getErrorMessage(err, 'unknown error')}`, 'error');
        // While the AI is not answering, use the built-in choice for this type; it can still be changed below.
        const fallback = await builtInCategory(type);
        if (fallback) applyBuiltIn(type, fallback);
        else setSuggestErrors((prev) => ({ ...prev, [type]: `${getErrorMessage(err, 'The AI could not suggest a category')} — choose one below.` }));
      }
    }
    suggestingRef.current = false;
    setSuggesting(false);
  }

  // Ask the AI once for each type that has no remembered Daraz category.
  useEffect(() => {
    if (!darazReady || (!status?.aiConfigured && !config.builtInFirst) || !items) return;
    const pending = types.filter((type) => !typeCategories[type] && !askedTypes.current.has(type));
    if (!pending.length) return;
    for (const type of pending) askedTypes.current.add(type);
    void suggestFor(pending);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [darazReady, status?.aiConfigured, items, types, config.builtInFirst]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectNeedingSync() {
    setSelected(new Set((items || []).filter((i) => statusOf(i) !== 'synced').map(idOf)));
  }

  const allShownSelected = shown.length > 0 && shown.every((i) => selected.has(idOf(i)));
  function toggleShown() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const item of shown) {
        if (allShownSelected) next.delete(idOf(item));
        else next.add(idOf(item));
      }
      return next;
    });
  }

  const toSync = (items || []).filter((i) => selected.has(idOf(i)));
  // With Daraz connected, a product that can be listed there needs its type's Daraz category first.
  const typesWithoutCategory = darazReady
    ? [...new Set(toSync.filter((i) => i.available && !typeCategories[i.type]).map((i) => i.type))].sort()
    : [];

  /**
   * The Daraz category for a type. While the AI is still choosing categories, waits until this type has one, so the run
   * can start right away instead of after every type is done. Null when the AI is finished and the type has none.
   */
  async function categoryWhenReady(type: string) {
    let announced = false;
    for (;;) {
      const category = categoriesRef.current[type];
      if (category) return category;
      if (!suggestingRef.current || stopRef.current) return null;
      if (!announced) addLog(`Waiting for the AI to choose the Daraz category for ${type}…`);
      announced = true;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  function depsFor(item: I, category: TypeCategory | null, darazPausedReason?: string): SyncDeps {
    const id = idOf(item);
    return {
      source: config.sourceFor(item),
      rate,
      daraz: { ready: darazReady, category, pausedReason: darazPausedReason },
      ensureCategory: (category) => ensureStoreCategory(category, storeCategories || []),
      createProduct: async (payload) => (await api.post<{ _id: string }>('/products', payload)).data,
      updateProduct: async (productId, payload) => {
        try {
          await api.put(`/products/${productId}`, payload);
          return true;
        } catch (err) {
          if (axios.isAxiosError(err) && err.response?.status === 404) return false;
          throw err;
        }
      },
      prepareDaraz: prepareDarazListing,
      publishDaraz: publishToDaraz,
      saveLink: async (link) => {
        await config.saveLink({ ...link, id });
        freshLinks.current.set(id, { ...link, id });
      },
      ...(config.hostImages ? { hostImages: () => config.hostImages!(item, addLog) } : {}),
      onStage: (step) => setStage((prev) => ({ ...prev, [id]: step })),
      log: addLog,
      knownListing: config.knownListing,
    };
  }

  async function run() {
    if (!toSync.length || running || (typesWithoutCategory.length && !suggesting)) return;
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
    const tally = { listed: 0, darazFailed: 0, darazSkipped: 0, darazBlocked: 0, storeFailed: 0, noPicture: 0 };
    let blocks = 0;
    let darazPausedReason: string | undefined;
    let done = 0;
    let storeFailures = 0;
    let darazFailures = 0;
    let haltedBecause = '';
    const leftForLater = new Set<string>();
    // Types that already have a category go first; the rest follow in the order the AI works through them.
    const queue = [...toSync].sort((a, b) => {
      const ready = Number(!typeCategories[a.type]) - Number(!typeCategories[b.type]);
      return ready || (typeCategories[a.type] ? 0 : a.type.localeCompare(b.type));
    });
    for (const item of queue) {
      if (stopRef.current) break;
      const id = idOf(item);
      const needsCategory = darazReady && item.available;
      const daraz = needsCategory ? await categoryWhenReady(item.type) : categoriesRef.current[item.type] || null;
      if (stopRef.current) break;
      if (needsCategory && !daraz) {
        // Listing it now would give QuantumStore a different category than Daraz later: leave it for the next run.
        if (!leftForLater.has(item.type)) addLog(`No Daraz category for ${item.type}: its products are left for later. Choose one above and press Sync again.`, 'error');
        leftForLater.add(item.type);
        continue;
      }
      const product = config.storeCategory ? { ...item, storeCategory: config.storeCategory(item, daraz) } : item;
      setResults((prev) => ({ ...prev, [id]: 'running' }));
      const latestLink = () => freshLinks.current.get(id) ?? linkById.get(id);
      let result = await syncItem(product, latestLink(), depsFor(item, daraz, darazPausedReason));
      // The AI (Groq) is busy or unreachable: wait and send this product to Daraz again instead of failing it.
      // QuantumStore is already done.
      for (let attempt = 1, why = aiUnavailable(result); why && !stopRef.current; attempt += 1, why = aiUnavailable(result)) {
        addLog(`${why}: waiting 1 minute, then sending ${item.name} to Daraz again (try ${attempt + 1})`, 'error');
        const terminal = new AbortController();
        terminalCountdown(RATE_LIMIT_WAIT, `${why}: ${item.name} (try ${attempt + 1})`, terminal.signal);
        for (let left = RATE_LIMIT_WAIT; left > 0 && !stopRef.current; left -= 1) {
          setCountdown({ why, left });
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        setCountdown(null);
        if (stopRef.current) terminal.abort();
        if (stopRef.current) break;
        const retry = await syncItem(product, latestLink(), depsFor(item, daraz, darazPausedReason));
        result = { ...retry, store: result.store, storeMessage: result.storeMessage };
      }
      setResults((prev) => ({ ...prev, [id]: result }));
      done += 1;
      if (result.daraz === 'listed') tally.listed += 1;
      else if (result.daraz === 'failed') tally.darazFailed += 1;
      else if (result.daraz === 'blocked') tally.darazBlocked += 1;
      else if (result.daraz === 'skipped') tally.darazSkipped += 1;
      if (result.store === 'failed') tally.storeFailed += 1;
      if (result.store === 'skipped') tally.noPicture += 1;
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
      `Finished${stopRef.current ? ' (stopped)' : ''}: ${done} of ${toSync.length} handled · on Daraz ${tally.listed} · Daraz failed ${tally.darazFailed} · Daraz skipped ${tally.darazSkipped} · Daraz brand not authorized ${tally.darazBlocked} · QuantumStore failed ${tally.storeFailed}${tally.noPicture ? ` · skipped (no working picture) ${tally.noPicture}` : ''}`,
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
        await markSoldOut(link, async (productId, stock) => void (await api.patch(`/products/${productId}/stock`, { stock })), config.saveLink);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, linkById, darazReady, typeCategories]);

  return (
    <div>
      <h1>{name}</h1>
      <p className="muted">{config.intro}</p>

      <div className="admin-toolbar">
        <span className="muted">
          {catalog.isPending
            ? `Reading ${site}…`
            : items
              ? `${items.length} products · ${counts.new} new · ${counts.changed} changed · ${counts['daraz-missing']} not on Daraz · ${counts.synced} synced`
              : ''}
        </span>
        <div className="admin-quick">
          <button type="button" className="btn btn-ghost" disabled={catalog.isFetching || running} onClick={() => catalog.refetch()}>
            {catalog.isFetching ? 'Reading…' : `Refresh from ${site}`}
          </button>
          <button type="button" className="btn btn-ghost" disabled={running} onClick={selectNeedingSync}>
            Select what needs syncing
          </button>
          <button type="button" className="btn btn-ghost" disabled={running || !selected.size} onClick={() => setSelected(new Set())}>
            Select none
          </button>
        </div>
      </div>

      {adopted.length > 0 && adoptedNotice && <p className="muted">{adoptedNotice(adopted.length)}</p>}
      {notice && (
        <p className="form-error" role="alert">
          {notice}
        </p>
      )}
      {catalog.isError && <p className="form-error">{getErrorMessage(catalog.error, `Could not read ${site}`)}</p>}
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
          <span className="muted">{removed.length} synced products are no longer listed by {name}.</span>
          <button type="button" className="btn btn-secondary" disabled={markingRemoved || running} onClick={markRemovedSoldOut}>
            {markingRemoved ? 'Marking…' : 'Mark them sold out on QuantumStore'}
          </button>
        </div>
      )}

      {items && (
        <>
          <input
            type="search"
            className="input"
            placeholder="Filter by name, type or brand"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Filter products"
            style={{ margin: '1rem 0 0.5rem', maxWidth: '24rem' }}
          />
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th className="col-check">
                    <input type="checkbox" checked={allShownSelected} onChange={toggleShown} aria-label="Select all shown products" />
                  </th>
                  <th>Product</th>
                  <th>{name} price</th>
                  <th>Daraz price</th>
                  <th>Status</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((item) => {
                  const id = idOf(item);
                  const category = typeCategories[item.type];
                  const commission = category ? commissionFor(groupOf(category.path)) : null;
                  const result = results[id];
                  return (
                    <tr key={id}>
                      <td data-label="Select" className="col-check">
                        <input
                          type="checkbox"
                          checked={selected.has(id)}
                          disabled={running}
                          onChange={() => toggle(id)}
                          aria-label={`Select ${item.name}`}
                        />
                      </td>
                      <td data-label="Product">
                        <div className="table-product">
                          <img src={item.thumbnail} alt="" width={40} height={40} loading="lazy" />
                          <div>
                            <strong>{item.name}</strong>
                            <div className="muted">
                              {config.describe(item)}
                              {item.available ? '' : ' · sold out'}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td data-label={`${name} price`}>{rs(item.pkr)}</td>
                      <td data-label="Daraz price">
                        {!item.available ? '—' : category ? rs(grossUpPrice(item.pkr, commission)) : 'pick a category'}
                      </td>
                      <td data-label="Status">{STATUS_TEXT[statusOf(item)]}</td>
                      <td data-label="Result">
                        {result === 'running' && (
                          <span className="muted">{stage[id] === 'daraz' ? 'QuantumStore done · sending to Daraz…' : 'Sending to QuantumStore…'}</span>
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
        </>
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
            {countdown !== null && (
              <div aria-live="off" style={{ color: 'var(--danger, #dc2626)' }}>
                <span className="muted">{countdown.why}</span> trying again in {countdown.left} s…
              </div>
            )}
            <div ref={logEndRef} />
          </div>
        </div>
      </details>

      <div className="publish-bar">
        {typesWithoutCategory.length > 0 && (
          <p className="form-error" role="alert" style={{ margin: 0 }}>
            {suggesting
              ? 'Choosing Daraz categories… You can press Sync now: products whose type has a category go first, the rest wait for theirs.'
              : `Choose a Daraz category for ${typesWithoutCategory.join(', ')} above, so these products go to Daraz as well as QuantumStore.`}
          </p>
        )}
        <div className="admin-quick">
          {!running ? (
            <button type="button" className="btn btn-primary" disabled={!toSync.length || !rateReady || (typesWithoutCategory.length > 0 && !suggesting)} onClick={run}>
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
