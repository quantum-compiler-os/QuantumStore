import api from '../../api/client';
import { downloadStoreImage, getStoreCatalog, saveStoreLink, type StoreInfo } from '../../api/stores';
import type { Pictures } from '../audionic/syncOne';
import { fitPictureForDaraz, hostPictures, storeCategoryFor } from '../camsham/camsham';
import type { SupplierConfig } from '../suppliers/SupplierSyncPage';
import { MARKUP_PKR, storeSku, withMarkup, type PricedStoreItem } from './storeFetcher';

async function uploadImage(file: File) {
  const body = new FormData();
  body.append('image', file);
  const { data } = await api.post<{ url: string; thumbnail?: string }>('/uploads', body, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

// Pictures already copied in this visit, so a product retried after a Groq wait is not uploaded a second time.
const hosted = new Map<string, Promise<Pictures>>();

/**
 * The sync page's settings for one fetched shop (Store fetcher and Auto finder). `address` is what was typed or found;
 * `host` keys links, categories and SKUs.
 */
export function storeConfig(address: string, host: string, onRead?: (info: StoreInfo) => void): SupplierConfig<PricedStoreItem> {
  return {
    name: host,
    site: host,
    intro: (
      <>
        Brings {host}&apos;s products into QuantumStore and Daraz. QuantumStore gets the shop&apos;s price + Rs {MARKUP_PKR};
        Daraz gets that price plus Daraz&apos;s commission for the category. Products are grouped by the shop&apos;s own
        product types, each with its own Daraz category. Pictures are copied to our own storage first; products with no
        working picture are skipped. Sold-out items stay on QuantumStore only.
      </>
    ),
    categoryStorageKey: `ql_store_categories_${host}`,
    fetchCatalog: async () => {
      const { store, items, links } = await getStoreCatalog(address);
      onRead?.(store);
      return {
        items: items.map((item) => withMarkup(item)),
        links: links.map(({ storeProductId, ...link }) => ({ id: storeProductId, ...link })),
      };
    },
    idOf: (item) => item.id,
    sourceFor: (item) => ({ id: item.id, label: host, brand: item.brand, sellerSku: storeSku(item.id) }),
    saveLink: ({ id, ...link }) => saveStoreLink({ storeProductId: id, ...link }),
    describe: (item) => `${item.type} · ${item.brand} · shop price Rs ${item.shopPkr.toLocaleString()}`,
    storeCategory: (item, daraz) => storeCategoryFor(item.type, daraz),
    priceLabel: `Our price (+Rs ${MARKUP_PKR})`,
    hostImages: (item, log) => {
      let copy = hosted.get(item.id);
      if (!copy) {
        copy = hostPictures(item.darazImages, {
          download: async (url) => fitPictureForDaraz(await downloadStoreImage(url)),
          upload: uploadImage,
          copiesOf: (url) => item.pictureCopies?.[url] ?? [],
          onSkip: (url, reason) => log(`${item.name} — picture left out (${reason}): ${url}`, 'error'),
          label: host,
        });
        copy.catch(() => hosted.delete(item.id));
        hosted.set(item.id, copy);
      }
      return copy;
    },
  };
}
