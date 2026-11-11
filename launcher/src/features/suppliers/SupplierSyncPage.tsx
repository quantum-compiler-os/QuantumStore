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
  StorageError,
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
import { STORE_EXTRA_PKR, storeRupees } from '../products/pricing';
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
  /** Title of the price column (QuantumStore's price); "<name> price" when the supplier's price is used as it is. */
  priceLabel?: string;
};

/** What one run did, for the Auto finder's summary. */
export type RunSummary = {
  handled: number;
  total: number;
  /** New products made on QuantumStore. */
  created: number;
  listed: number;
  darazFailed: number;
  darazSkipped: number;
  darazBlocked: number;
  storeFailed: number;
  noPicture: number;
  /** Stop was pressed (a run never stops itself). */
  stopped: boolean;
  /** Types with no Daraz category: their products were left for a later run. */
  leftForLater: string[];
  /** The catalog could not be read (or the run broke), so nothing was synced. */
  error?: string;
};

export const EMPTY_SUMMARY: RunSummary = {
  handled: 0,
  total: 0,
  created: 0,
  listed: 0,
  darazFailed: 0,
  darazSkipped: 0,
  darazBlocked: 0,
  storeFailed: 0,
  noPicture: 0,
  stopped: false,
  leftForLater: [],
};

/** Hands-free mode (Auto finder): sync up to `limit` products (0: all) as soon as the page is ready, then report back. */
export type AutoRun = { limit: number; signal: AbortSignal; onDone: (summary: RunSummary) => void };

type LogLine = { time: string; level: 'info' | 'error'; text: string };

const MAX_LOG_LINES = 500;

/** Rows drawn in the table at once (a catalog of thousands would make the page crawl); the filter narrows the rest. */
const MAX_ROWS = 300;

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
  /** Sync without a click and report back (Auto finder). */
  auto?: AutoRun;
};

export default function SupplierSyncPage<I extends SourceItem>({ config, adopt, adoptedNotice, auto }: Props<I>) {
  const { name, site, idOf } = config;
  const priceLabel = config.priceLabel ?? `${name} price`;
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
  const statusQuery = useQuery({ queryKey: ['daraz', 'status'], queryFn: getDarazStatus, retry: false });
  const status = statusQuery.data;
  // Answered or failed: either way the Auto finder knows whether Daraz is connected.
  const statusSettled = statusQuery.isFetched;
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

  /**
   * Syncs `list` (the ticked products unless given). `unattended` (Auto finder) asks nothing: without Daraz the products
   * go to QuantumStore only, and types the AI found no category for are left for later instead of holding the run back.
   */
  /** Counts a minute down at the end of the log (and in the terminal); false when Stop was pressed meanwhile. */
  async function waitAMinute(why: string, what: string) {
    const terminal = new AbortController();
    terminalCountdown(RATE_LIMIT_WAIT, `${why}: ${what}`, terminal.signal);
    for (let left = RATE_LIMIT_WAIT; left > 0 && !stopRef.current; left -= 1) {
      setCountdown({ why, left });
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    setCountdown(null);
    if (stopRef.current) terminal.abort();
    return !stopRef.current;
  }

  async function run(list: I[] = toSync, { unattended = false } = {}): Promise<RunSummary | null> {
    if (!list.length || running || (!unattended && typesWithoutCategory.length && !suggesting)) return null;
    if (!darazReady && !unattended) {
      const goOn = await confirm(
        'Daraz is not connected, so these products will only be added to QuantumStore. Connect Daraz in Settings first if you want them there too.',
        { title: 'Sync to QuantumStore only?', confirmLabel: 'Only QuantumStore' },
      );
      if (!goOn) return null;
    }
    setRunning(true);
    setNotice('');
    // The Auto finder's Stop may already have been pressed while this shop's catalog was read.
    stopRef.current = Boolean(auto?.signal.aborted);
    addLog(
      `Starting: ${list.length} products · ${darazReady ? 'Daraz connected' : 'Daraz NOT connected (QuantumStore only)'} · ` +
        types.map((type) => `${type} → ${typeCategories[type]?.path || 'no category'}`).join(' | '),
    );
    const tally = { created: 0, listed: 0, darazFailed: 0, darazSkipped: 0, darazBlocked: 0, storeFailed: 0, noPicture: 0 };
    let blocks = 0;
    let darazPausedReason: string | undefined;
    let done = 0;
    let storeFailures = 0;
    let darazFailures = 0;
    const leftForLater = new Set<string>();
    // Types that already have a category go first; the rest follow in the order the AI works through them.
    const queue = [...list].sort((a, b) => {
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
      // What a wait fixes (our picture storage down, the AI busy or unreachable) never ends the run: the product waits a
      // minute and is tried again, as often as it takes, until it goes through or Stop is pressed.
      let result: SyncResult | null = null;
      for (let attempt = 1; !stopRef.current; attempt += 1) {
        let next: SyncResult;
        try {
          next = await syncItem(product, latestLink(), depsFor(item, daraz, darazPausedReason));
        } catch (err) {
          if (!(err instanceof StorageError)) throw err;
          // Every product would fail the same way, so this one waits instead of being skipped.
          setResults((prev) => ({ ...prev, [id]: { store: 'failed', daraz: 'skipped', storeMessage: err.message, darazMessage: 'Waiting for pictures' } }));
          addLog(`${item.name} — ${err.message}`, 'error');
          addLog(`Picture storage is not working: waiting 1 minute, then trying ${item.name} again (try ${attempt + 1}). Press Stop to end the run.`, 'error');
          if (!(await waitAMinute('Picture storage not working', `${item.name} (try ${attempt + 1})`))) break;
          setResults((prev) => ({ ...prev, [id]: 'running' }));
          continue;
        }
        // A retry only concerns Daraz: QuantumStore's outcome is the one from the first time it was done.
        result = result ? { ...next, store: result.store, storeMessage: result.storeMessage } : next;
        const why = aiUnavailable(result);
        if (!why) break;
        addLog(`${why}: waiting 1 minute, then sending ${item.name} to Daraz again (try ${attempt + 1})`, 'error');
        if (!(await waitAMinute(why, `${item.name} (try ${attempt + 1})`))) break;
      }
      if (!result) {
        // Stopped while waiting for picture storage: nothing happened to this product; the next run picks it up again.
        setResults((prev) => ({ ...prev, [id]: { store: 'failed', daraz: 'skipped', storeMessage: 'Stopped while waiting for picture storage', darazMessage: 'Not tried' } }));
        break;
      }
      const finished = result;
      setResults((prev) => ({ ...prev, [id]: finished }));
      done += 1;
      if (result.daraz === 'listed') tally.listed += 1;
      else if (result.daraz === 'failed') tally.darazFailed += 1;
      else if (result.daraz === 'blocked') tally.darazBlocked += 1;
      else if (result.daraz === 'skipped') tally.darazSkipped += 1;
      if (result.store === 'created') tally.created += 1;
      if (result.store === 'failed') tally.storeFailed += 1;
      if (result.store === 'skipped') tally.noPicture += 1;
      addLog(`(${done}/${list.length}) done`);

      // Daraz keeps refusing the brand: stop asking it for the rest of this run, but keep filling QuantumStore.
      blocks = consecutiveBlocked(blocks, result);
      if (blocks >= PAUSE_DARAZ_AFTER_BLOCKS && !darazPausedReason) {
        darazPausedReason = `Daraz paused for this run: it refused the brand ${PAUSE_DARAZ_AFTER_BLOCKS} times in a row`;
        addLog(`${darazPausedReason}. The remaining products only go to QuantumStore.`, 'error');
      }

      // The run never stops itself (only the Stop button ends it early); a streak of failures is flagged once in the
      // log so a broken connection or setting is noticed.
      storeFailures = consecutiveFailures(storeFailures, result, 'store');
      darazFailures = consecutiveFailures(darazFailures, result, 'daraz');
      if (storeFailures === STOP_AFTER_FAILURES) addLog(`Warning: QuantumStore refused ${STOP_AFTER_FAILURES} products in a row (${result.storeMessage}). Carrying on; press Stop if this needs fixing first.`, 'error');
      if (darazFailures === STOP_AFTER_FAILURES) addLog(`Warning: Daraz refused ${STOP_AFTER_FAILURES} products in a row (${result.darazMessage}). Carrying on; press Stop if this needs fixing first.`, 'error');
    }
    setRunning(false);
    const stopped = stopRef.current;
    addLog(
      `Finished${stopped ? ' (stopped)' : ''}: ${done} of ${list.length} handled · on Daraz ${tally.listed} · Daraz failed ${tally.darazFailed} · Daraz skipped ${tally.darazSkipped} · Daraz brand not authorized ${tally.darazBlocked} · QuantumStore failed ${tally.storeFailed}${tally.noPicture ? ` · skipped (no working picture) ${tally.noPicture}` : ''}`,
      tally.darazFailed || tally.storeFailed ? 'error' : 'info',
    );
    if (!unattended) toast.success(`${done} of ${list.length} products synced${stopped ? ' (stopped)' : ''}`);
    await Promise.all([catalog.refetch(), queryClient.invalidateQueries({ queryKey: queryKeys.products.all })]);
    return { handled: done, total: list.length, ...tally, stopped, leftForLater: [...leftForLater] };
  }

  // Auto finder: once the catalog, the Daraz status and the PKR rate are in, sync without a click and report back.
  // Already-synced products are left out; in-stock ones (which can also go to Daraz) go first, up to `auto.limit`.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!auto || autoStarted.current) return;
    if (catalog.isError) {
      autoStarted.current = true;
      auto.onDone({ ...EMPTY_SUMMARY, error: getErrorMessage(catalog.error, `Could not read ${site}`) });
      return;
    }
    if (!items || !statusSettled || !rateReady) return;
    autoStarted.current = true;
    const needing = items.filter((i) => itemStatus(i, linkById.get(idOf(i)), { darazReady, hasCategory: true }) !== 'synced');
    const ordered = [...needing.filter((i) => i.available), ...needing.filter((i) => !i.available)];
    const list = auto.limit > 0 ? ordered.slice(0, auto.limit) : ordered;
    setSelected(new Set(list.map(idOf)));
    if (!list.length) {
      addLog('Nothing new or changed here: every product is already synced.');
      auto.onDone(EMPTY_SUMMARY);
      return;
    }
    void run(list, { unattended: true }).then(
      (summary) => auto.onDone(summary ?? EMPTY_SUMMARY),
      (err) => auto.onDone({ ...EMPTY_SUMMARY, error: getErrorMessage(err, err instanceof Error ? err.message : 'The sync stopped unexpectedly') }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, items, statusSettled, rateReady, catalog.isError]);

  // The Auto finder's Stop ends this shop's run after the current product, like the Stop button below.
  useEffect(() => {
    const signal = auto?.signal;
    if (!signal) return;
    const stop = () => (stopRef.current = true);
    if (signal.aborted) stop();
    signal.addEventListener('abort', stop);
    return () => signal.removeEventListener('abort', stop);
  }, [auto?.signal]);

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
                  <th>{priceLabel}</th>
                  <th title={`${priceLabel} + Rs ${STORE_EXTRA_PKR.toLocaleString()}`}>QuantumStore price</th>
                  <th>Daraz price</th>
                  <th>Status</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, MAX_ROWS).map((item) => {
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
                      <td data-label={priceLabel}>{rs(item.pkr)}</td>
                      <td data-label="QuantumStore price">{rs(storeRupees(item.pkr))}</td>
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
          {shown.length > MAX_ROWS && (
            <p className="muted" style={{ margin: '0.5rem 0' }}>
              Showing the first {MAX_ROWS} of {shown.length.toLocaleString()} products. The tick box in the header still
              selects all {shown.length.toLocaleString()} that match the filter; type in the filter to narrow the list.
            </p>
          )}
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
            <button type="button" className="btn btn-primary" disabled={!toSync.length || !rateReady || (typesWithoutCategory.length > 0 && !suggesting)} onClick={() => void run()}>
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
