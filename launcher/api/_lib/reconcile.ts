import type { DarazItem } from './darazCore.js';

/** The part of a QuantumStore product the sync needs. `price` is as the store keeps it (rupees ÷ PKR rate). */
export type StoreProduct = {
  id: string;
  name: string;
  description: string;
  price: number;
  stock: number | null;
  brand: string;
  category: string;
  image: string;
  images: string[];
};

/** A row of the Launcher's own table of products it put on Daraz. */
export type ListingRef = { quantumProductId: string; darazItemId: string; sellerSku: string };

export type SyncPlan = {
  /** Same product on both sides but not tracked yet (matched by name): only the link is saved. */
  link: Array<{ product: StoreProduct; item: DarazItem }>;
  /** On Daraz but not on QuantumStore: gets created on QuantumStore. */
  importToStore: DarazItem[];
  /** On QuantumStore but not on Daraz: gets listed on Daraz. */
  listOnDaraz: StoreProduct[];
  /** Tracked, but deleted on QuantumStore: its Daraz item goes too. Destructive, so applied only on request. */
  removeFromDaraz: Array<{ listing: ListingRef; item: DarazItem }>;
  /** Tracked, but deleted on Daraz: its QuantumStore product goes too. Destructive, so applied only on request. */
  removeFromStore: Array<{ listing: ListingRef; product: StoreProduct }>;
  /** Tracked, but gone from both sides: the stale tracking row is dropped. */
  dropLinks: ListingRef[];
  /** Left alone: products the Audionic page manages. */
  managed: number;
  /** Left alone: QuantumStore products that are sold out (nothing to list on Daraz). */
  soldOut: number;
};

/** "Zia ul Quran" and "zia-ul quran!" are the same product when deciding whether two sides already match. */
export const nameKey = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * Works out what the sync would do. Nothing here touches the network: it only compares what is on QuantumStore, what is
 * on Daraz and what the Launcher has recorded.
 *
 * `managedProductIds` belong to the Audionic page, which has its own sync and rules (sold-out items stay on QuantumStore
 * only, for example), so they are never listed, linked or removed here.
 */
export function planSync(input: {
  store: StoreProduct[];
  daraz: DarazItem[];
  listings: ListingRef[];
  managedProductIds?: Iterable<string>;
}): SyncPlan {
  const managedIds = new Set(input.managedProductIds ?? []);
  const storeById = new Map(input.store.map((product) => [product.id, product]));
  const darazById = new Map(input.daraz.map((item) => [item.itemId, item]));
  // A row without a store product id (from before ids were saved) cannot be compared, so its Daraz item counts as untracked.
  const tracked = input.listings.filter((listing) => listing.quantumProductId);

  const plan: SyncPlan = {
    link: [],
    importToStore: [],
    listOnDaraz: [],
    removeFromDaraz: [],
    removeFromStore: [],
    dropLinks: [],
    managed: 0,
    soldOut: 0,
  };

  const trackedProducts = new Set<string>();
  const trackedItems = new Set<string>();
  for (const listing of tracked) {
    trackedProducts.add(listing.quantumProductId);
    trackedItems.add(listing.darazItemId);
    if (managedIds.has(listing.quantumProductId)) continue;
    const product = storeById.get(listing.quantumProductId);
    const item = darazById.get(listing.darazItemId);
    if (product && item) continue;
    if (product && !item) plan.removeFromStore.push({ listing, product });
    else if (!product && item) plan.removeFromDaraz.push({ listing, item });
    else plan.dropLinks.push(listing);
  }

  const looseProducts = input.store.filter((product) => {
    if (managedIds.has(product.id)) {
      plan.managed += 1;
      return false;
    }
    return !trackedProducts.has(product.id);
  });
  const matchable = new Map<string, StoreProduct[]>();
  for (const product of looseProducts) {
    const key = nameKey(product.name);
    matchable.set(key, [...(matchable.get(key) ?? []), product]);
  }
  const matched = new Set<string>();

  for (const item of input.daraz) {
    if (trackedItems.has(item.itemId)) continue;
    const candidate = (matchable.get(nameKey(item.name)) ?? []).find((product) => !matched.has(product.id));
    if (candidate && item.name) {
      matched.add(candidate.id);
      plan.link.push({ product: candidate, item });
    } else {
      plan.importToStore.push(item);
    }
  }

  for (const product of looseProducts) {
    if (matched.has(product.id)) continue;
    if (product.stock !== null && product.stock <= 0) plan.soldOut += 1;
    else plan.listOnDaraz.push(product);
  }
  return plan;
}

/**
 * A reason not to trust the lists at all, or null. An empty answer from one side while the Launcher tracks products is
 * far more likely to be a hiccup (wrong shop, expired token, backend waking up) than everything having been deleted.
 */
export function sourcesProblem(counts: { store: number; daraz: number; listings: number }) {
  if (counts.listings === 0) return null;
  if (counts.daraz === 0) return `Daraz returned no items although ${counts.listings} are tracked here, so the sync stopped instead of guessing`;
  if (counts.store === 0) return `QuantumStore returned no products although ${counts.listings} are tracked here, so the sync stopped instead of guessing`;
  return null;
}

/** A reason not to apply the removals, or null: more than half of what is tracked "disappearing" at once looks like a fault. */
export function removalsProblem(plan: SyncPlan, tracked: number) {
  const removals = plan.removeFromDaraz.length + plan.removeFromStore.length;
  if (removals >= 3 && removals * 2 > tracked) {
    return `${removals} of ${tracked} tracked products look deleted, which is too many to be believable — check both shops and run it again`;
  }
  return null;
}
