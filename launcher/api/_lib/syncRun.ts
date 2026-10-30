import { commissionFor, grossUpPrice, groupOf } from '../../shared/commission.js';
import { descriptionForDaraz, descriptionProblem } from '../../shared/darazText.js';
import { rupeesToStored, storedToRupees } from '../../shared/pricing.js';
import { htmlToText, type DarazCategoryLeaf, type DarazItem } from './darazCore.js';
import { HttpError } from './http.js';
import {
  planSync,
  removalsProblem,
  sourcesProblem,
  type ListingRef,
  type StoreProduct,
  type SyncPlan,
} from './reconcile.js';

/** Daraz needs a quantity; a store product with untracked stock is listed with this many (the same as the Audionic sync). */
export const DEFAULT_DARAZ_QUANTITY = 10;
const IMPORT_CATEGORY = 'Imported from Daraz';
const NO_BRAND = 'No Brand';

export type StoredListing = ListingRef & { skuId: string; categoryId: number };

export type PreparedForDaraz = {
  category: { id: number; path: string } | null;
  attributes: Record<string, string>;
  package: { weight: number; length: number; width: number; height: number } | null;
  description?: string;
  missing: Array<{ name: string; label: string }>;
};

/** Everything the sync touches, passed in so it can be tested without a network. */
export type SyncDeps = {
  store: {
    products: () => Promise<StoreProduct[]>;
    rate: () => Promise<number>;
    ensureCategory: (name: string) => Promise<string>;
    createProduct: (payload: Record<string, unknown>) => Promise<{ _id: string }>;
    deleteProduct: (id: string) => Promise<void>;
  };
  daraz: {
    items: () => Promise<DarazItem[]>;
    leaves: () => Promise<DarazCategoryLeaf[]>;
    removeItem: (item: DarazItem) => Promise<void>;
    prepare: (input: { name: string; brand: string; description: string }) => Promise<PreparedForDaraz>;
    publish: (request: Record<string, unknown>) => Promise<{ itemId: string }>;
  };
  listings: {
    all: () => Promise<StoredListing[]>;
    save: (listing: StoredListing) => Promise<void>;
    removeByItem: (darazItemId: string) => Promise<void>;
  };
  /** QuantumStore product ids that the Audionic page manages. */
  managedProductIds: () => Promise<string[]>;
  log: (text: string) => void;
};

export type Failure = { action: string; name: string; reason: string };

export type SyncReport = {
  /** Set when the run stopped before doing anything because the lists could not be trusted. */
  problem?: string;
  imported: string[];
  listed: string[];
  linked: string[];
  removedFromDaraz: string[];
  removedFromStore: string[];
  droppedLinks: number;
  /** What would be removed but was not, because removals were not switched on (or looked wrong). */
  pendingRemovals: { fromDaraz: string[]; fromStore: string[]; blocked?: string };
  skipped: { managed: number; soldOut: number };
  failures: Failure[];
};

const names = (items: Array<{ name: string }>) => items.map((item) => item.name || '(no name)');

export type SyncPreview = {
  problem?: string;
  importToStore: string[];
  listOnDaraz: string[];
  link: string[];
  removeFromDaraz: string[];
  removeFromStore: string[];
  droppedLinks: number;
  skipped: { managed: number; soldOut: number };
};

async function load(deps: SyncDeps) {
  const [store, daraz, listings, managed] = await Promise.all([
    deps.store.products(),
    deps.daraz.items(),
    deps.listings.all(),
    deps.managedProductIds(),
  ]);
  const problem = sourcesProblem({ store: store.length, daraz: daraz.length, listings: listings.length });
  const plan = planSync({ store, daraz, listings, managedProductIds: managed });
  return { store, daraz, listings, plan, problem };
}

/** What a run would do, without doing any of it. */
export async function previewSync(deps: SyncDeps): Promise<SyncPreview> {
  const { plan, problem } = await load(deps);
  return {
    problem: problem ?? undefined,
    importToStore: names(plan.importToStore),
    listOnDaraz: names(plan.listOnDaraz),
    link: plan.link.map((pair) => pair.product.name),
    removeFromDaraz: plan.removeFromDaraz.map((entry) => entry.item.name || entry.listing.sellerSku),
    removeFromStore: plan.removeFromStore.map((entry) => entry.product.name),
    droppedLinks: plan.dropLinks.length,
    skipped: { managed: plan.managed, soldOut: plan.soldOut },
  };
}

const reasonOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Errors that make every following call fail the same way; the run stops instead of repeating them for each product. */
function isFatal(err: unknown) {
  return err instanceof HttpError && [401, 403, 429].includes(err.status);
}

/** The store category a Daraz item belongs under: the second level of Daraz's path ("Audio › Sound Bars" → "Audio"). */
function storeCategoryFor(item: DarazItem, leaves: DarazCategoryLeaf[]) {
  const leaf = leaves.find((candidate) => candidate.id === item.categoryId);
  const parts = leaf?.path.split(' › ') ?? [];
  return parts[1] || parts[0] || IMPORT_CATEGORY;
}

/** Rupees the seller keeps on a Daraz price: the reverse of the publish formula (price − commission%). */
function netRupees(item: DarazItem, leaves: DarazCategoryLeaf[]) {
  const leaf = leaves.find((candidate) => candidate.id === item.categoryId);
  const commission = leaf ? commissionFor(groupOf(leaf.path)) : null;
  return Math.round(item.price * (1 - (commission ?? 0) / 100));
}

export function storePayloadFromDaraz(item: DarazItem, rate: number, leaves: DarazCategoryLeaf[], category: string) {
  const [cover, ...rest] = item.images;
  const description = htmlToText(item.description);
  return {
    name: item.name,
    description: description.length >= 10 ? description : `${item.name} — imported from Daraz`,
    price: rupeesToStored(netRupees(item, leaves), rate),
    category,
    stock: item.quantity,
    image: cover,
    thumbnail: cover,
    images: rest,
    variants: [],
    specs: [],
    brand: item.brand && item.brand !== NO_BRAND ? item.brand : 'Generic',
    featured: false,
    productType: 'standard' as const,
  };
}

/** The same SKU rules as Publish: letters, digits and dashes, plus a per-product suffix so two products never clash. */
export function sellerSkuFor(product: StoreProduct) {
  const base = product.name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return `${base || 'PRODUCT'}-${product.id.slice(-6).toUpperCase()}`;
}

/**
 * Applies the plan: imports and listings always (they only add), removals only with `applyRemovals`. Each product is
 * handled on its own, so one that Daraz or the store refuses is reported and the rest carry on.
 */
export async function runSync(deps: SyncDeps, { applyRemovals }: { applyRemovals: boolean }): Promise<SyncReport> {
  const report: SyncReport = {
    imported: [],
    listed: [],
    linked: [],
    removedFromDaraz: [],
    removedFromStore: [],
    droppedLinks: 0,
    pendingRemovals: { fromDaraz: [], fromStore: [] },
    skipped: { managed: 0, soldOut: 0 },
    failures: [],
  };
  const { log } = deps;
  const fail = (action: string, name: string, err: unknown) => {
    log(`${action}: "${name}" FAILED — ${reasonOf(err)}`);
    report.failures.push({ action, name, reason: reasonOf(err) });
    if (isFatal(err)) throw err;
  };

  log('Reading QuantumStore, Daraz and the Launcher’s own records…');
  const { plan, problem } = await load(deps);
  if (problem) {
    log(problem);
    report.problem = problem;
    return report;
  }
  report.skipped = { managed: plan.managed, soldOut: plan.soldOut };
  log(
    `Found ${plan.importToStore.length} to import from Daraz, ${plan.listOnDaraz.length} to list on Daraz, ${plan.link.length} to link, ` +
      `${plan.removeFromDaraz.length + plan.removeFromStore.length} to remove, ${plan.dropLinks.length} stale records` +
      (plan.managed ? `; ${plan.managed} Audionic products are left to the Audionic page` : ''),
  );

  const needsLeaves = plan.importToStore.length || plan.listOnDaraz.length;
  const leaves = needsLeaves ? await deps.daraz.leaves() : [];
  const rate = plan.importToStore.length || plan.listOnDaraz.length ? await deps.store.rate() : 1;

  // 1. Daraz items the store lacks → create them on QuantumStore.
  for (const item of plan.importToStore) {
    const label = item.name || item.sellerSku || item.itemId;
    try {
      if (!item.name) throw new Error('the Daraz item has no name');
      if (!item.images.length) throw new Error('the Daraz item has no image');
      log(`Import from Daraz: "${label}"…`);
      const category = await deps.store.ensureCategory(storeCategoryFor(item, leaves));
      const created = await deps.store.createProduct(storePayloadFromDaraz(item, rate, leaves, category));
      await deps.listings.save({
        quantumProductId: created._id,
        darazItemId: item.itemId,
        sellerSku: item.sellerSku,
        skuId: item.skuId,
        categoryId: item.categoryId,
      });
      report.imported.push(label);
      log(`Import from Daraz: "${label}" created on QuantumStore (Rs ${netRupees(item, leaves)})`);
    } catch (err) {
      fail('Import from Daraz', label, err);
    }
  }

  // 2. The same product already on both sides → just remember the pairing.
  for (const { product, item } of plan.link) {
    try {
      await deps.listings.save({
        quantumProductId: product.id,
        darazItemId: item.itemId,
        sellerSku: item.sellerSku,
        skuId: item.skuId,
        categoryId: item.categoryId,
      });
      report.linked.push(product.name);
      log(`Linked "${product.name}" to its existing Daraz item ${item.itemId}`);
    } catch (err) {
      fail('Link', product.name, err);
    }
  }

  // 3. Store products Daraz lacks → list them on Daraz.
  for (const product of plan.listOnDaraz) {
    try {
      log(`List on Daraz: "${product.name}"…`);
      const outcome = await listOnDaraz(deps, product, rate);
      if ('skipped' in outcome) {
        log(`List on Daraz: "${product.name}" skipped — ${outcome.skipped}`);
        report.failures.push({ action: 'List on Daraz', name: product.name, reason: outcome.skipped });
      } else {
        report.listed.push(product.name);
        log(`List on Daraz: "${product.name}" listed as item ${outcome.itemId}`);
      }
    } catch (err) {
      fail('List on Daraz', product.name, err);
    }
  }

  // 4. Tracking rows whose product is gone from both sides.
  for (const listing of plan.dropLinks) {
    try {
      await deps.listings.removeByItem(listing.darazItemId);
      report.droppedLinks += 1;
    } catch (err) {
      fail('Drop record', listing.sellerSku, err);
    }
  }

  // 5. Removals: shown always, done only on request and only if the numbers look believable.
  const pending = {
    fromDaraz: plan.removeFromDaraz.map((entry) => entry.item.name || entry.listing.sellerSku),
    fromStore: names(plan.removeFromStore.map((entry) => entry.product)),
  };
  if (pending.fromDaraz.length + pending.fromStore.length) {
    const blocked = applyRemovals ? removalsProblem(plan, (await deps.listings.all()).length + plan.dropLinks.length) : null;
    if (!applyRemovals || blocked) {
      report.pendingRemovals = { ...pending, blocked: blocked ?? undefined };
      log(
        blocked
          ? `Removals NOT applied: ${blocked}`
          : `${pending.fromDaraz.length + pending.fromStore.length} removals are waiting for your confirmation (run again with removals switched on)`,
      );
    } else {
      await applyRemovalsFor(deps, plan, report, fail);
    }
  }

  log(
    `Done: ${report.imported.length} imported, ${report.listed.length} listed, ${report.linked.length} linked, ` +
      `${report.removedFromDaraz.length + report.removedFromStore.length} removed, ${report.failures.length} problems`,
  );
  return report;
}

async function applyRemovalsFor(
  deps: SyncDeps,
  plan: SyncPlan,
  report: SyncReport,
  fail: (action: string, name: string, err: unknown) => void,
) {
  for (const { listing, item } of plan.removeFromDaraz) {
    const label = item.name || listing.sellerSku;
    try {
      deps.log(`Remove from Daraz: "${label}" (deleted on QuantumStore)…`);
      await deps.daraz.removeItem(item);
      await deps.listings.removeByItem(listing.darazItemId);
      report.removedFromDaraz.push(label);
    } catch (err) {
      fail('Remove from Daraz', label, err);
    }
  }
  for (const { listing, product } of plan.removeFromStore) {
    try {
      deps.log(`Remove from QuantumStore: "${product.name}" (deleted on Daraz)…`);
      await deps.store.deleteProduct(product.id);
      await deps.listings.removeByItem(listing.darazItemId);
      report.removedFromStore.push(product.name);
    } catch (err) {
      fail('Remove from QuantumStore', product.name, err);
    }
  }
}

/** Lists one QuantumStore product on Daraz. Resolves `{ skipped }` with the reason when it cannot be done honestly. */
export async function listOnDaraz(deps: SyncDeps, product: StoreProduct, rate: number): Promise<{ itemId: string } | { skipped: string }> {
  const images = [product.image, ...product.images].filter(Boolean);
  if (!images.length) return { skipped: 'the product has no image' };
  if (images.some((url) => !/^https:\/\//i.test(url))) return { skipped: 'its images are not public https links (set the backend to Google Drive storage)' };

  const prepared = await deps.daraz.prepare({ name: product.name, brand: product.brand, description: product.description });
  if (!prepared.category) return { skipped: 'no Daraz category could be chosen (needs GROQ_API_KEY, or list it once by hand from Publish)' };
  if (!prepared.package) return { skipped: 'the package size could not be estimated' };
  if (prepared.missing.length) return { skipped: `Daraz needs: ${prepared.missing.map((field) => field.label).join(', ')}` };

  const description = descriptionForDaraz({ description: product.description, aiDescription: prepared.description ?? '', specs: [] });
  const tooShort = descriptionProblem(description);
  if (tooShort) return { skipped: tooShort };

  const rupees = storedToRupees(product.price, rate);
  if (!(rupees > 0)) return { skipped: 'the product has no price' };
  const price = grossUpPrice(rupees, commissionFor(groupOf(prepared.category.path)));
  const quantity = product.stock === null ? DEFAULT_DARAZ_QUANTITY : product.stock;

  const created = await deps.daraz.publish({
    quantumProductId: product.id,
    categoryId: prepared.category.id,
    name: product.name,
    description,
    brand: product.brand || NO_BRAND,
    sellerSku: sellerSkuFor(product),
    quantity,
    price,
    images: images.slice(0, 8),
    specs: [],
    package: { ...prepared.package, content: product.name },
    attributes: prepared.attributes,
  });
  return { itemId: created.itemId };
}
