import type { StoreInfo, StoreItem } from '../../api/stores';

/** Rupees added to the shop's price for QuantumStore. Daraz gets this price plus its commission on top. */
export const MARKUP_PKR = 500;

export const PLATFORM_NAME: Record<StoreInfo['platform'], string> = { shopify: 'Shopify', woocommerce: 'WooCommerce' };

/** A fetched product priced for us: `pkr` (what QuantumStore charges) is the shop's price plus the markup. */
export type PricedStoreItem = StoreItem & { shopPkr: number };

export function withMarkup(item: StoreItem, markup = MARKUP_PKR): PricedStoreItem {
  return {
    ...item,
    shopPkr: item.pkr,
    pkr: item.pkr + markup,
    variants: item.variants.map((v) => ({ ...v, pkr: v.pkr + markup })),
  };
}

/**
 * The same Daraz SKU every time for the same shop product, so Daraz rejects a duplicate instead of listing it twice:
 * "SF-", up to 10 letters of the shop's name, and its product id ("example.pk/123" → "SF-EXAMPLEPK-123").
 */
export function storeSku(id: string) {
  const slash = id.indexOf('/');
  const shop = id.slice(0, slash).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
  const product = id.slice(slash + 1).replace(/[^A-Za-z0-9_-]/g, '');
  return `SF-${shop}-${product}`;
}

/** The shop's name as the server keys it ("https://www.Example.pk/shop" → "example.pk"); empty when not an address. */
export function shopHost(address: string) {
  const text = address.trim().toLowerCase();
  if (!text) return '';
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(text) ? text : `https://${text}`);
    return url.hostname.replace(/\.$/, '').replace(/^www\./, '');
  } catch {
    return '';
  }
}

const RECENT_KEY = 'ql_store_fetcher_recent';
const MAX_RECENT = 8;

/** Shops read before on this PC, newest first (a convenience only: empty in a private window). */
export function recentStores(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(list) ? list.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

export function rememberStore(host: string) {
  const next = [host, ...recentStores().filter((s) => s !== host)].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* private mode: remembering is a convenience only */
  }
  return next;
}
