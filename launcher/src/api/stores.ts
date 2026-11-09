import type { FoundShop } from '../../api/_lib/storeFinder';
import type { StoreInfo, StoreItem } from '../../api/_lib/storeFetcher';
import { launcherApi } from './daraz';

export type { FoundShop, StoreInfo, StoreItem };

/** Shops the AI names for `focus` (candidates only: check each with `checkStore`). */
export async function discoverStores(focus: string, count: number, exclude: string[]) {
  const { data } = await launcherApi.post<{ shops: FoundShop[] }>('/stores/discover', { focus, count, exclude }, { timeout: 90_000 });
  return data.shops;
}

/** Whether a shop can be fetched from: what it runs on and its currency, or an error saying why not. */
export async function checkStore(store: string) {
  const { data } = await launcherApi.get<{ store: StoreInfo }>('/stores/check', { params: { store }, timeout: 90_000 });
  return data.store;
}

/** What an earlier sync made out of one product from a fetched shop. */
export type StoreLinkRow = {
  storeProductId: string;
  quantumProductId: string;
  darazItemId: string | null;
  sellerSku: string;
  sourcePkr: number;
  available: boolean;
};

/** A shop's current catalog as listable items (its own prices, no markup), and the links from earlier syncs. */
export async function getStoreCatalog(store: string) {
  // A big shop is dozens of pages: give the server time to read them all.
  const { data } = await launcherApi.get<{ store: StoreInfo; fetched: number; items: StoreItem[]; links: StoreLinkRow[] }>('/stores/catalog', {
    params: { store },
    timeout: 180_000,
  });
  return data;
}

export async function saveStoreLink(link: StoreLinkRow) {
  await launcherApi.post('/stores/link', link);
}

/** One of the shop's pictures, read through the Launcher's server (the browser cannot read it across sites). */
export async function downloadStoreImage(url: string) {
  const { data } = await launcherApi.get<Blob>('/stores/image', { params: { url }, responseType: 'blob', timeout: 60_000 });
  return data;
}
