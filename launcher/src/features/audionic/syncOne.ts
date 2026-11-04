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

/**
 * The parts of a supplier product (Audionic, CamSham…) that the sync needs. Each supplier's reader produces these
 * fields; the supplier's own id lives in `SyncSource` so the sync does not care what it is called.
 */
export type SourceItem = Pick<
  AudionicItem,
  'name' | 'type' | 'storeCategory' | 'description' | 'specs' | 'image' | 'thumbnail' | 'images' | 'darazImages' | 'variants' | 'pkr' | 'available'
>;

/** Where a product's pictures live: on QuantumStore (cover, thumbnail, the rest) and the copies Daraz downloads. */
export type Pictures = Pick<SourceItem, 'image' | 'thumbnail' | 'images' | 'darazImages'>;

/** What an earlier sync made out of one supplier product, without the supplier's id (the page adds it back). */
export type SourceLink = Omit<AudionicLinkRow, 'audionicId'>;

/** Which supplier a product comes from: its id there, the name shown in messages, the brand and the Daraz SKU. */
export type SyncSource = { id: string; label: string; brand: string; sellerSku: string };

export const audionicSource = (item: Pick<AudionicItem, 'audionicId'>): SyncSource => ({
  id: item.audionicId,
  label: 'Audionic',
  brand: BRAND,
  sellerSku: sellerSkuFor(item.audionicId),
});

export type ItemStatus = 'new' | 'changed' | 'daraz-missing' | 'synced';

/** What a sync run would do with an item, from what was saved last time. */
export function itemStatus(
  item: Pick<SourceItem, 'pkr' | 'available'>,
  link: SourceLink | undefined,
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

/** Prices are rupees as the supplier lists them; the store keeps them divided by the PKR rate. */
function variantsOf(item: SourceItem, rate: number) {
  return item.variants.map((v) => ({ label: v.label, price: rupeesToStored(v.pkr, rate), stock: stockOf(v.available) }));
}

export function storePayload(item: SourceItem, rate: number, category: string, brand = BRAND) {
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
    brand,
    featured: false,
    productType: 'standard' as const,
  };
}

/** What a re-sync refreshes on an existing product: price, availability and pictures. Texts the owner edited stay. */
export function refreshPayload(item: SourceItem, rate: number) {
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
  /** The supplier this product comes from. */
  source: SyncSource;
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
    fillRest?: boolean;
  }) => Promise<PreparedListing>;
  /** Ready-made Daraz text and package size for a supplier product, if there is one (shared/audionicListing.json). */
  knownListing?: (sourceId: string) => KnownListing | undefined;
  publishDaraz: (request: DarazPublishRequest) => Promise<DarazPublishResult>;
  /**
   * Copies the supplier's pictures to our own storage and returns the copies. Left out, the supplier's addresses are
   * used as they are. Called at most once per product, and only when a product is created or first sent to Daraz.
   */
  hostImages?: () => Promise<Pictures>;
  /** Remembers what this product became; the page adds the supplier's id. */
  saveLink: (link: SourceLink) => Promise<void>;
  /** Called as each half starts, so the page can show "QuantumStore…" then "Daraz…" for the product in progress. */
  onStage?: (stage: 'store' | 'daraz') => void;
  /** Receives a plain-text line for every step, so the page can show what is being tried and why something failed. */
  log?: (text: string, level?: 'info' | 'error') => void;
};

/**
 * Thrown by `hostImages` when the supplier has no picture that works for a product (missing or broken files on their
 * site). The product is skipped, not failed: nothing on our side is wrong, so the run carries on.
 */
export class NoPicturesError extends Error {}

/** Daraz's per-category price cap ("Max Price Spam" policy): the product can only be sold on QuantumStore. */
const isAbovePriceCap = (message: string) => /max price spam|price exceeds the allowed threshold/i.test(message);

export type SyncResult = {
  /** `skipped`: the supplier has no working picture for it, so it was not listed anywhere. */
  store: 'created' | 'refreshed' | 'unchanged' | 'skipped' | 'failed';
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

export const brandBlockedMessage = (brand: string) =>
  `Daraz refused this product even as "No Brand" (brand policy). ` +
  `Request brand authorization for ${brand} in Seller Center (Brands), then sync again.`;

export const BRAND_BLOCKED_MESSAGE = brandBlockedMessage(BRAND);

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
 * Brings one supplier product up to date on QuantumStore and Daraz. A new product is created on both; a changed
 * one gets its store price, availability and pictures refreshed (Daraz is left alone). Either half can fail without
 * undoing the other, and the saved link makes the next run pick up only what is missing.
 */
export async function syncItem(
  item: SourceItem,
  link: SourceLink | undefined,
  deps: SyncDeps,
): Promise<SyncResult> {
  const result: SyncResult = { store: 'unchanged', daraz: 'unchanged' };
  const { source } = deps;
  const brand = source.brand;
  const sellerSku = link?.sellerSku || source.sellerSku;
  let productId = link?.quantumProductId;
  const darazItemId = link?.darazItemId ?? null;
  const log = (text: string, level: 'info' | 'error' = 'info') => deps.log?.(`${item.name} — ${text}`, level);
  let hosted: Promise<Pictures> | undefined;
  const pictures = () => {
    if (!deps.hostImages) return Promise.resolve<Pictures>(item);
    if (!hosted) {
      log(`copying ${item.darazImages.length} picture${item.darazImages.length === 1 ? '' : 's'} to our storage`);
      hosted = deps.hostImages();
    }
    return hosted;
  };

  const save = (itemId: string | null) =>
    deps.saveLink({
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
      const refresh = refreshPayload(item, deps.rate);
      // Copied pictures stay as they are; only the supplier's own addresses are refreshed.
      const payload = deps.hostImages ? { price: refresh.price, stock: refresh.stock, variants: refresh.variants } : refresh;
      if (await deps.updateProduct(link.quantumProductId, payload)) {
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
      const shown = { ...item, ...(await pictures()) };
      productId = (await deps.createProduct(storePayload(shown, deps.rate, category, brand)))._id;
      result.store = 'created';
      log(`QuantumStore: created (${productId})`);
    }
    if (result.store === 'unchanged') log('QuantumStore: nothing to change');
  } catch (err) {
    const message = messageOf(err, 'Could not save the product');
    if (err instanceof NoPicturesError) {
      log(`skipped — ${message}`, 'error');
      return { store: 'skipped', daraz: 'skipped', storeMessage: message, darazMessage: 'No picture' };
    }
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
  if (!item.available) return skip(`Sold out on ${source.label}`);
  if (deps.daraz.pausedReason) return skip(deps.daraz.pausedReason);
  if (!deps.daraz.ready) return skip('Daraz is not connected');
  if (!deps.daraz.category) return skip(`Choose a Daraz category for ${item.type}`);

  deps.onStage?.('daraz');
  try {
    const { id: categoryId, path } = deps.daraz.category;
    const quantity = String(DARAZ_QUANTITY);
    log(`Daraz: trying — category ${path}`);
    const known = deps.knownListing?.(source.id);
    log(
      known
        ? 'Daraz: using the ready-made description and package size; the AI only fills any other required fields'
        : 'Daraz: asking the AI for the English texts, package size and required fields',
    );
    const prepared = await deps.prepareDaraz({
      name: item.name,
      brand,
      description: item.description,
      specs: item.specs,
      categoryId,
      attributes: {},
      ...(known ? { known } : {}),
      // Nobody is there to type a field the AI left empty, so it gets a neutral value instead of failing the listing.
      fillRest: true,
    });
    const plan = applyPrepared({ ...initialDaraz(), categoryId, categoryLabel: path, quantity, sellerSku }, prepared);
    // Daraz price = the same rupee price pushed through the commission formula (price ÷ (1 − commission%)).
    const price = String(item.pkr);
    const filled = Object.keys(plan.attributes).length;
    log(
      `Daraz: AI done — package ${plan.weight} kg, ${plan.length}×${plan.width}×${plan.height} cm, ${filled} category field${filled === 1 ? '' : 's'} filled` +
        (prepared.placeholders?.length
          ? `, set as not applicable: ${prepared.placeholders.map((p) => `${p.label} = ${p.value}`).join(', ')}`
          : '') +
        (prepared.missing.length ? `, still missing: ${prepared.missing.map((m) => m.label).join(', ')}` : ''),
    );
    const problem = darazProblem(plan, price, quantity);
    if (problem) throw new Error(problem);
    // The supplier's own text is often one line; Daraz wants at least 30 words, so add the AI text and the specs.
    const description = descriptionForDaraz({ description: item.description, aiDescription: plan.aiDescription, specs: item.specs });
    const tooShort = descriptionProblem(description);
    if (tooShort) throw new Error(tooShort);

    const darazImages = (await pictures()).darazImages;
    const darazAmount = darazPrice(plan, price);
    log(
      `Daraz: sending — Rs ${darazAmount.toLocaleString()} (${source.label} Rs ${item.pkr.toLocaleString()} + commission), quantity ${DARAZ_QUANTITY}, SKU ${sellerSku}, ${darazImages.length} image${darazImages.length === 1 ? '' : 's'}`,
    );
    const published = await deps.publishDaraz({
      quantumProductId: productId,
      categoryId,
      name: item.name,
      description,
      brand,
      sellerSku,
      quantity: DARAZ_QUANTITY,
      price: darazAmount,
      specialPrice: null,
      images: darazImages,
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
      const blocked = brandBlockedMessage(brand);
      log(`Daraz: BLOCKED — ${blocked}`, 'error');
      return { ...result, daraz: 'blocked', darazMessage: blocked };
    }
    if (isAbovePriceCap(message)) {
      const capped = 'Daraz does not allow a price this high in this category (Max Price policy); it stays on QuantumStore only';
      log(`Daraz: skipped — ${capped}`, 'error');
      return { ...result, daraz: 'skipped', darazMessage: capped };
    }
    log(`Daraz: FAILED — ${message}`, 'error');
    return { ...result, daraz: 'failed', darazMessage: message };
  }
}

/**
 * A product the supplier no longer lists: mark it sold out on QuantumStore (Daraz is left alone) and remember that,
 * so it is not offered again on the next run.
 */
export async function markSoldOut<L extends SourceLink>(
  link: L,
  setStock: (productId: string, stock: number) => Promise<void>,
  saveLink: (link: L) => Promise<void>,
) {
  await setStock(link.quantumProductId, 0);
  await saveLink({ ...link, available: false });
}
