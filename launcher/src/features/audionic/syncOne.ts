import type { AudionicItem, AudionicLinkRow } from '../../api/audionic';
import type { DarazPublishRequest, DarazPublishResult, PreparedListing } from '../../api/daraz';
import { descriptionForDaraz, descriptionProblem, isBrandNotAuthorized } from '../../../shared/darazText';
import { getErrorMessage } from '../../utils/errors';
import { applyPrepared, darazPrice, darazProblem, initialDaraz } from '../daraz/darazForm';
import { rupeesToStored } from '../products/pricing';
import type { KnownListing } from '../../../shared/knownListing';

/** Audionic only says "available" or "sold out"; Daraz needs a number, so every available item is listed with this many. */
export const DARAZ_QUANTITY = 10;
const BRAND = 'Audionic';

/** The same SKU every time for the same Audionic product, so Daraz rejects a duplicate instead of listing it twice. */
export const sellerSkuFor = (audionicId: string) => `AUD-${audionicId}`;

export type ItemStatus = 'new' | 'changed' | 'daraz-missing' | 'synced';

/** What a sync run would do with an item, from what was saved last time. */
export function itemStatus(
  item: AudionicItem,
  link: AudionicLinkRow | undefined,
  { darazReady, hasCategory }: { darazReady: boolean; hasCategory: boolean },
): ItemStatus {
  if (!link) return 'new';
  if (link.sourcePkr !== item.pkr || link.available !== item.available) return 'changed';
  if (!link.darazItemId && item.available && darazReady && hasCategory) return 'daraz-missing';
  return 'synced';
}

/**
 * Products the old backend sync imported (they carry `source.store === 'audionic'`) that this app has not linked yet.
 * They are adopted instead of duplicated: `sourcePkr: 0` makes the next sync see a price change, so the product is
 * repriced to Audionic's exact price (the old sync listed it Rs 100 lower) and then listed on Daraz like any other.
 */
export function adoptedLinks(
  products: Array<{ _id: string; stock?: number | null; source?: { store?: string; productId?: string } | null }>,
  links: AudionicLinkRow[],
): AudionicLinkRow[] {
  const known = new Set(links.map((link) => link.audionicId));
  const adopted: AudionicLinkRow[] = [];
  for (const product of products) {
    const audionicId = product.source?.store === 'audionic' ? product.source.productId : undefined;
    if (!audionicId || known.has(audionicId)) continue;
    known.add(audionicId);
    adopted.push({
      audionicId,
      quantumProductId: product._id,
      darazItemId: null,
      sellerSku: sellerSkuFor(audionicId),
      sourcePkr: 0,
      available: product.stock !== 0,
    });
  }
  return adopted;
}

/** Synced products Audionic no longer lists and that are not yet marked sold out. */
export function removedLinks(items: AudionicItem[], links: AudionicLinkRow[]) {
  const live = new Set(items.map((item) => item.audionicId));
  return links.filter((link) => link.available && !live.has(link.audionicId));
}

const stockOf = (available: boolean) => (available ? null : 0);

/** Prices are rupees as Audionic lists them; the store keeps them divided by the PKR rate. */
function variantsOf(item: AudionicItem, rate: number) {
  return item.variants.map((v) => ({ label: v.label, price: rupeesToStored(v.pkr, rate), stock: stockOf(v.available) }));
}

export function storePayload(item: AudionicItem, rate: number, category: string) {
  return {
    name: item.name,
    description: item.description,
    price: rupeesToStored(item.pkr, rate),
    category,
    stock: stockOf(item.available),
    image: item.image,
    thumbnail: item.thumbnail,
    images: item.images,
    variants: variantsOf(item, rate),
    specs: item.specs,
    brand: BRAND,
    featured: false,
    productType: 'standard' as const,
  };
}

/** What a re-sync refreshes on an existing product: price, availability and pictures. Texts the owner edited stay. */
export function refreshPayload(item: AudionicItem, rate: number) {
  return {
    price: rupeesToStored(item.pkr, rate),
    stock: stockOf(item.available),
    variants: variantsOf(item, rate),
    image: item.image,
    thumbnail: item.thumbnail,
    images: item.images,
  };
}

export type SyncDeps = {
  /** Rupees per base price unit (Settings → PKR rate). */
  rate: number;
  daraz: {
    ready: boolean;
    /** The Daraz category chosen for this item's type, if any. */
    category: { id: number; path: string } | null;
    /** When set, Daraz is not attempted for this item and this is why (e.g. the run paused after repeated brand refusals). */
    pausedReason?: string;
  };
  ensureCategory: (name: string) => Promise<string>;
  createProduct: (payload: Record<string, unknown>) => Promise<{ _id: string }>;
  /** Resolves false when the product no longer exists on QuantumStore. */
  updateProduct: (id: string, payload: Record<string, unknown>) => Promise<boolean>;
  prepareDaraz: (input: {
    name: string;
    brand: string;
    description: string;
    specs: Array<{ key: string; value: string }>;
    categoryId: number | null;
    attributes: Record<string, string>;
    known?: KnownListing;
  }) => Promise<PreparedListing>;
  /** Ready-made Daraz text and package size for an Audionic product, if there is one (shared/audionicListing.json). */
  knownListing?: (audionicId: string) => KnownListing | undefined;
  publishDaraz: (request: DarazPublishRequest) => Promise<DarazPublishResult>;
  saveLink: (link: AudionicLinkRow) => Promise<void>;
  /** Called as each half starts, so the page can show "QuantumStore…" then "Daraz…" for the product in progress. */
  onStage?: (stage: 'store' | 'daraz') => void;
  /** Receives a plain-text line for every step, so the page can show what is being tried and why something failed. */
  log?: (text: string, level?: 'info' | 'error') => void;
};

export type SyncResult = {
  store: 'created' | 'refreshed' | 'unchanged' | 'failed';
  /** `blocked`: Daraz refused the brand (needs brand authorization), which is not a fault in the product or the Launcher. */
  daraz: 'listed' | 'unchanged' | 'skipped' | 'failed' | 'blocked';
  storeMessage?: string;
  darazMessage?: string;
};

/**
 * A long run stops itself when the same step keeps failing, instead of repeating the failure for every product.
 * Counts how many products in a row failed on `step`; any product that worked on it starts the count again.
 */
export const STOP_AFTER_FAILURES = 3;

/** After this many brand refusals in a row the run stops asking Daraz (QuantumStore carries on) instead of repeating it. */
export const PAUSE_DARAZ_AFTER_BLOCKS = 5;

export const BRAND_BLOCKED_MESSAGE =
  `Daraz refused this product even as "No Brand" (brand policy). ` +
  `Request brand authorization for ${BRAND} in Seller Center (Brands), then sync again.`;

export function consecutiveBlocked(previous: number, result: SyncResult) {
  if (result.daraz === 'blocked') return previous + 1;
  return result.daraz === 'listed' ? 0 : previous;
}

export function consecutiveFailures(previous: number, result: SyncResult, step: 'store' | 'daraz') {
  const failed = result[step] === 'failed';
  const worked = step === 'store' ? result.store !== 'failed' : result.daraz === 'listed';
  if (failed) return previous + 1;
  return worked ? 0 : previous; // "skipped" or "unchanged" says nothing about whether the step works
}

const messageOf = (err: unknown, fallback: string) => getErrorMessage(err, err instanceof Error ? err.message : fallback);

/**
 * Brings one Audionic product up to date on QuantumStore and Daraz. A new product is created on both; a changed
 * one gets its store price, availability and pictures refreshed (Daraz is left alone). Either half can fail without
 * undoing the other, and the saved link makes the next run pick up only what is missing.
 */
export async function syncItem(
  item: AudionicItem,
  link: AudionicLinkRow | undefined,
  deps: SyncDeps,
): Promise<SyncResult> {
  const result: SyncResult = { store: 'unchanged', daraz: 'unchanged' };
  const sellerSku = link?.sellerSku || sellerSkuFor(item.audionicId);
  let productId = link?.quantumProductId;
  const darazItemId = link?.darazItemId ?? null;
  const log = (text: string, level: 'info' | 'error' = 'info') => deps.log?.(`${item.name} — ${text}`, level);

  const save = (itemId: string | null) =>
    deps.saveLink({
      audionicId: item.audionicId,
      quantumProductId: productId as string,
      darazItemId: itemId,
      sellerSku,
      sourcePkr: item.pkr,
      available: item.available,
    });

  // 1. QuantumStore
  deps.onStage?.('store');
  try {
    if (link && (link.sourcePkr !== item.pkr || link.available !== item.available)) {
      log(`QuantumStore: updating the existing product to Rs ${item.pkr.toLocaleString()}${item.available ? '' : ' (sold out)'}`);
      if (await deps.updateProduct(link.quantumProductId, refreshPayload(item, deps.rate))) {
        result.store = 'refreshed';
        log('QuantumStore: updated');
      } else {
        productId = undefined; // deleted on QuantumStore since: create it again below
        log('QuantumStore: the old product is gone, creating it again');
      }
    }
    if (!productId) {
      log(`QuantumStore: creating the product at Rs ${item.pkr.toLocaleString()} (category ${item.storeCategory})`);
      const category = await deps.ensureCategory(item.storeCategory);
      productId = (await deps.createProduct(storePayload(item, deps.rate, category)))._id;
      result.store = 'created';
      log(`QuantumStore: created (${productId})`);
    }
    if (result.store === 'unchanged') log('QuantumStore: nothing to change');
  } catch (err) {
    const message = messageOf(err, 'Could not save the product');
    log(`QuantumStore: FAILED — ${message}`, 'error');
    return { store: 'failed', daraz: 'skipped', storeMessage: message, darazMessage: 'Waiting for QuantumStore' };
  }
  try {
    if (result.store !== 'unchanged') await save(darazItemId);
  } catch (err) {
    // The product exists but is not remembered, so the next run would list it again: say so loudly.
    result.storeMessage = `Created, but could not remember it (a re-sync would duplicate it): ${messageOf(err, 'link not saved')}`;
  }

  // 2. Daraz
  const skip = (reason: string): SyncResult => {
    log(`Daraz: skipped — ${reason}`);
    return { ...result, daraz: 'skipped', darazMessage: reason };
  };
  if (darazItemId) {
    log(`Daraz: already listed (item ${darazItemId}), not touched`);
    return result;
  }
  if (!item.available) return skip('Sold out on Audionic');
  if (deps.daraz.pausedReason) return skip(deps.daraz.pausedReason);
  if (!deps.daraz.ready) return skip('Daraz is not connected');
  if (!deps.daraz.category) return skip(`Choose a Daraz category for ${item.type}`);

  deps.onStage?.('daraz');
  try {
    const { id: categoryId, path } = deps.daraz.category;
    const quantity = String(DARAZ_QUANTITY);
    log(`Daraz: trying — category ${path}`);
    const known = deps.knownListing?.(item.audionicId);
    log(
      known
        ? 'Daraz: using the ready-made description and package size; the AI only fills any other required fields'
        : 'Daraz: asking the AI for the English texts, package size and required fields',
    );
    const prepared = await deps.prepareDaraz({
      name: item.name,
      brand: BRAND,
      description: item.description,
      specs: item.specs,
      categoryId,
      attributes: {},
      ...(known ? { known } : {}),
    });
    const plan = applyPrepared({ ...initialDaraz(), categoryId, categoryLabel: path, quantity, sellerSku }, prepared);
    // Daraz price = the same rupee price pushed through the commission formula (price ÷ (1 − commission%)).
    const price = String(item.pkr);
    const filled = Object.keys(plan.attributes).length;
    log(
      `Daraz: AI done — package ${plan.weight} kg, ${plan.length}×${plan.width}×${plan.height} cm, ${filled} category field${filled === 1 ? '' : 's'} filled` +
        (prepared.missing.length ? `, still missing: ${prepared.missing.map((m) => m.label).join(', ')}` : ''),
    );
    const problem = darazProblem(plan, price, quantity);
    if (problem) throw new Error(problem);
    // Audionic's own text is often one line; Daraz wants at least 30 words, so add the AI text and the specs.
    const description = descriptionForDaraz({ description: item.description, aiDescription: plan.aiDescription, specs: item.specs });
    const tooShort = descriptionProblem(description);
    if (tooShort) throw new Error(tooShort);

    const darazAmount = darazPrice(plan, price);
    log(
      `Daraz: sending — Rs ${darazAmount.toLocaleString()} (Audionic Rs ${item.pkr.toLocaleString()} + commission), quantity ${DARAZ_QUANTITY}, SKU ${sellerSku}, ${item.darazImages.length} image${item.darazImages.length === 1 ? '' : 's'}`,
    );
    const published = await deps.publishDaraz({
      quantumProductId: productId,
      categoryId,
      name: item.name,
      description,
      brand: BRAND,
      sellerSku,
      quantity: DARAZ_QUANTITY,
      price: darazAmount,
      specialPrice: null,
      images: item.darazImages,
      specs: item.specs,
      package: {
        weight: Number(plan.weight),
        length: Number(plan.length),
        width: Number(plan.width),
        height: Number(plan.height),
        content: item.name,
      },
      attributes: plan.attributes,
    });
    await save(published.itemId);
    const notes = published.changes?.length ? published.changes : published.brandReplaced ? ['listed as No Brand'] : [];
    const message = `Item ${published.itemId}${notes.length ? ` · ${notes.join(' · ')}` : ''}`;
    log(`Daraz: LISTED — ${message}`);
    return { ...result, daraz: 'listed', darazMessage: message };
  } catch (err) {
    const message = messageOf(err, 'Daraz refused the listing');
    if (isBrandNotAuthorized(message)) {
      // The server already retried once as "No Brand"; if Daraz still refuses, nothing else is attempted.
      log(`Daraz: BLOCKED — ${BRAND_BLOCKED_MESSAGE}`, 'error');
      return { ...result, daraz: 'blocked', darazMessage: BRAND_BLOCKED_MESSAGE };
    }
    log(`Daraz: FAILED — ${message}`, 'error');
    return { ...result, daraz: 'failed', darazMessage: message };
  }
}

/**
 * A product Audionic no longer lists: mark it sold out on QuantumStore (Daraz is left alone) and remember that,
 * so it is not offered again on the next run.
 */
export async function markSoldOut(
  link: AudionicLinkRow,
  setStock: (productId: string, stock: number) => Promise<void>,
  saveLink: (link: AudionicLinkRow) => Promise<void>,
) {
  await setStock(link.quantumProductId, 0);
  await saveLink({ ...link, available: false });
}
