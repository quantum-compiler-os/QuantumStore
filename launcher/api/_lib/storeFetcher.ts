/**
 * Reads another online shop's public product list and turns it into plain items ready to be listed on QuantumStore and
 * Daraz. The owner types the shop's address on the Store fetcher page; Shopify shops (`/products.json`) and WooCommerce
 * shops (the Store API) are read, which covers most Pakistani online shops. No database and no Daraz here, so it is
 * unit-tested in tests/storeFetcher.test.ts. Prices are the shop's own rupee prices: the page adds the markup.
 */
import { decodeEntities, parseProductDescription, sizedImage, type AudionicVariant, type ShopifyProduct } from './audionic.js';
import { toItem as wooItem, type WooCategory, type WooProduct, type WooVariation } from './camsham.js';
import { HttpError } from './http.js';
import { failureReason, withRetry } from './net.js';

const USER_AGENT = 'QuantumStoreLauncher/1.0 (+https://quantumlogicslimited.com)';
const SHOPIFY_PER_PAGE = 250;
const WOO_PER_PAGE = 100;
/** Up to 20,000 Shopify products or 10,000 WooCommerce products; bigger shops are cut off there. */
const MAX_PAGES = 80;
const WOO_MAX_PAGES = 100;
/** Pages read at once: quick, without tripping the shop's rate limit (4 at once tripped joyroom.pk's). */
const PARALLEL = 2;
const MAX_IMAGES = 8;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

/** Products the shop gives no type are grouped under this one (one Daraz category is chosen per type). */
export const OTHER_TYPE = 'Other';
const NO_BRAND = 'No Brand';

export type StorePlatform = 'shopify' | 'woocommerce';

export type StoreInfo = {
  /** Where the shop is read from, e.g. "https://www.example.pk". */
  origin: string;
  /** The shop's name in links and SKUs: its host without "www.", so "example.pk" and "www.example.pk" are one shop. */
  host: string;
  platform: StorePlatform;
  /** What the shop says it prices in; null when it does not say (taken as rupees). */
  currency: string | null;
};

export type StoreItem = {
  /** `<host>/<the shop's product id>`: unique across every shop read here. */
  id: string;
  url: string;
  name: string;
  /** The shop's vendor or brand; Daraz falls back to "No Brand" when it refuses it. */
  brand: string;
  /** The shop's own product type or most specific category: one Daraz category is chosen per type. */
  type: string;
  storeCategory: string;
  description: string;
  specs: Array<{ key: string; value: string }>;
  /** The shop's own picture addresses; the Launcher copies them to QuantumStore's storage before listing. */
  image: string;
  thumbnail: string;
  images: string[];
  darazImages: string[];
  /** WooCommerce only: each picture's resized copies (largest first), tried when the full-size file is broken. */
  pictureCopies?: Record<string, string[]>;
  variants: AudionicVariant[];
  /** The lowest price in rupees, exactly as the shop shows it (no markup yet). */
  pkr: number;
  available: boolean;
};

type Fetch = typeof fetch;

const isIpLiteral = (host: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':') || host.startsWith('[');

/** A real shop on the internet: not this PC, the local network, or a bare IP address. */
export function isPublicHost(host: string) {
  const name = host.toLowerCase().replace(/\.$/, '');
  if (!name.includes('.') || isIpLiteral(name)) return false;
  return !/(^|\.)(localhost|local|internal|lan|home|test|invalid)$/.test(name);
}

/**
 * Shops with their own page in the Launcher (their own links and SKUs): read here as well, every product would be listed
 * twice. Our own shop is here too.
 */
export const OWN_PAGES: Record<string, string> = {
  'audionic.co': 'it has its own page (Audionic) — use that, so its products are not listed twice',
  'camsham.pk': 'it has its own page (CamSham) — use that, so its products are not listed twice',
  'pakbooks.com': 'it has its own page (PakBooks) — use that, so its products are not listed twice',
  'quantumlogicslimited.com': 'that is our own shop',
};

/** Why a shop must not be read here, or null. Subdomains count ("store.quantumlogicslimited.com"). */
export function ownPageReason(host: string) {
  const match = Object.keys(OWN_PAGES).find((own) => host === own || host.endsWith(`.${own}`));
  return match ? OWN_PAGES[match] : null;
}

/** The shop's origin and host from whatever was typed ("example.pk", "https://www.example.pk/collections/all"…). */
export function storeOrigin(input: string) {
  const text = String(input || '').trim();
  if (!text) throw new HttpError(400, "Enter the shop's web address, e.g. example.pk");
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    throw new HttpError(400, `"${text}" is not a web address`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new HttpError(400, 'Enter a web address starting with https://');
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!isPublicHost(hostname)) throw new HttpError(400, 'Only shops on the public internet can be read');
  const host = hostname.replace(/^www\./, '');
  const own = ownPageReason(host);
  if (own) throw new HttpError(400, `${host} is not read here: ${own}`);
  return { origin: `https://${hostname}`, host };
}

type JsonAnswer = { ok: true; data: unknown; totalPages: number } | { ok: false; status: number };

/**
 * Times a shop that limits requests (429) is asked again before giving up: with the pauses below, about two minutes.
 * Shopify's limit ("local_rate_limited") usually lifts within a minute.
 */
const RATE_LIMIT_RETRIES = 6;
const MAX_RATE_LIMIT_PAUSE_MS = 60_000;

/** How long to wait after a 429: what the shop asks for (`Retry-After`), else 2 s, 4 s, 8 s… */
export function rateLimitPause(res: Response, attempt: number) {
  const asked = Number(res.headers.get('retry-after'));
  const ms = Number.isFinite(asked) && asked >= 0 && res.headers.has('retry-after') ? asked * 1000 : 2000 * 2 ** attempt;
  return Math.min(ms, MAX_RATE_LIMIT_PAUSE_MS);
}

/** GETs JSON from the shop. A page that is missing or not JSON is `ok: false`; an unreachable shop is an error. */
async function getJson(url: string, fetchImpl: Fetch): Promise<JsonAnswer> {
  let res: Response;
  for (let attempt = 0; ; attempt += 1) {
    try {
      res = await withRetry(() =>
        fetchImpl(url, { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(20_000) }),
      );
    } catch (err) {
      throw new HttpError(502, `Could not reach ${new URL(url).hostname} (${failureReason(err)}) — check the address and your connection`);
    }
    // The shop is limiting requests: wait as long as it asks and try again, instead of failing the whole catalog.
    if (res.status !== 429 || attempt >= RATE_LIMIT_RETRIES) break;
    await new Promise((resolve) => setTimeout(resolve, rateLimitPause(res, attempt)));
  }
  if (!res.ok || !(res.headers.get('content-type') || '').includes('json')) return { ok: false, status: res.status };
  try {
    return { ok: true, data: await res.json(), totalPages: Number(res.headers.get('x-wp-totalpages')) || 1 };
  } catch {
    return { ok: false, status: res.status };
  }
}

function checkCurrency(info: StoreInfo) {
  if (info.currency && info.currency !== 'PKR') {
    throw new HttpError(400, `${info.host} prices its products in ${info.currency}, not rupees (PKR), so they cannot be listed at the right price`);
  }
  return info;
}

/** Finds out which kind of shop it is (Shopify first, then WooCommerce) and what currency it uses. */
export async function detectStore(input: string, fetchImpl: Fetch = fetch): Promise<StoreInfo> {
  const { origin, host } = storeOrigin(input);
  const shopify = await getJson(`${origin}/products.json?limit=1`, fetchImpl);
  // Still rate-limited after the retries: the shop is busy, which says nothing about whether it can be read.
  if (!shopify.ok && shopify.status === 429) throw new HttpError(503, `${host} is still limiting requests after two minutes of retries — it is tried again later`);
  if (shopify.ok && Array.isArray((shopify.data as { products?: unknown })?.products)) {
    // A Shopify shop's /meta.json names its currency; some shops block it, and then rupees are assumed.
    const meta = await getJson(`${origin}/meta.json`, fetchImpl).catch(() => null);
    const currency = meta?.ok ? (meta.data as { currency?: unknown })?.currency : null;
    return checkCurrency({ origin, host, platform: 'shopify', currency: typeof currency === 'string' ? currency.toUpperCase() : null });
  }
  const woo = await getJson(`${origin}/wp-json/wc/store/v1/products?per_page=1`, fetchImpl);
  if (woo.ok && Array.isArray(woo.data)) {
    const currency = (woo.data[0] as { prices?: { currency_code?: unknown } } | undefined)?.prices?.currency_code;
    return checkCurrency({ origin, host, platform: 'woocommerce', currency: typeof currency === 'string' ? currency.toUpperCase() : null });
  }
  throw new HttpError(
    400,
    `${host} does not share a product list the fetcher can read. It reads Shopify and WooCommerce shops that publish their catalog.`,
  );
}

const isWebUrl = (src: string | undefined): src is string => /^(https:)?\/\//i.test(src || '');

// Many shops leave the product type empty. Rather than put all of those under one Daraz category, common product words
// in the name group them (first match wins: "Soundbar with Woofer" is a sound bar, not a speaker). Anything else is "Other".
const TYPE_BY_NAME: Array<[RegExp, string]> = [
  [/\b(ear\s?buds?|air\s?buds?|tws)\b/i, 'Earbuds'],
  [/\bneck\s?bands?\b/i, 'Neckbands'],
  [/\bhead\s?(phones?|sets?)\b/i, 'Headphones'],
  [/\bear\s?phones?\b|\bhands?\s?free\b/i, 'Earphones'],
  [/\bsound\s?bars?\b|\bhome\s?theat(er|re)\b/i, 'Sound Bars'],
  [/\bspeakers?\b|\bwoofers?\b/i, 'Speakers'],
  [/\bpower\s?banks?\b/i, 'Power Banks'],
  [/\bsmart\s?watch(es)?\b/i, 'Smart Watches'],
  [/\bchargers?\b/i, 'Chargers'],
  [/\bcables?\b/i, 'Cables'],
  [/\bmouse\b|\bmice\b/i, 'Mice'],
  [/\bkeyboards?\b/i, 'Keyboards'],
  [/\bmicrophones?\b|\bmics?\b/i, 'Microphones'],
  [/\btripods?\b/i, 'Tripods'],
  [/\bring\s?lights?\b/i, 'Ring Lights'],
  [/\b(phone|mobile)\s?(cases?|covers?)\b/i, 'Phone Cases'],
];

/** A type for a product the shop gave none, from its name; "Other" when nothing matches. */
export function typeFromName(name: string) {
  return TYPE_BY_NAME.find(([pattern]) => pattern.test(name))?.[1] ?? OTHER_TYPE;
}

type ShopifyStoreProduct = ShopifyProduct & { vendor?: string };

/** One Shopify product as a listable item, or null when it has no price above Rs 0 or no picture. */
export function shopifyItem(product: ShopifyStoreProduct, store: Pick<StoreInfo, 'origin' | 'host'>): StoreItem | null {
  const variants = (product.variants || []).filter((v) => Number(v.price) > 0);
  const sources = (product.images || []).map((img) => img.src).filter(isWebUrl).slice(0, MAX_IMAGES);
  if (!variants.length || !sources.length) return null;

  const name = decodeEntities(product.title || '').replace(/\s+/g, ' ').trim();
  if (!name) return null;
  const { description, specs } = parseProductDescription(product.body_html || '', name);
  const type = decodeEntities(product.product_type || '').replace(/\s+/g, ' ').trim() || typeFromName(name);
  const hasOptions = !(product.variants.length === 1 && product.variants[0].title === 'Default Title');
  const [cover, ...rest] = sources;
  return {
    id: `${store.host}/${product.id}`,
    url: `${store.origin}/products/${product.handle}`,
    name,
    brand: decodeEntities(product.vendor || '').trim() || NO_BRAND,
    type,
    storeCategory: type,
    description: description || `${name}.`,
    specs,
    image: sizedImage(cover, 1200),
    thumbnail: sizedImage(cover, 400),
    images: rest.map((src) => sizedImage(src, 1200)),
    // Daraz only takes JPEG/PNG; Shopify converts on request.
    darazImages: sources.map((src) => sizedImage(src, 1200, true)),
    variants: hasOptions ? variants.map((v) => ({ label: v.title.trim(), pkr: Number(v.price), available: Boolean(v.available) })) : [],
    pkr: Math.min(...variants.map((v) => Number(v.price))),
    available: variants.some((v) => v.available),
  };
}

/** The product's most specific WooCommerce category (the deepest one it is filed under), "Uncategorized" aside. */
export function wooType(product: Pick<WooProduct, 'categories'>, categories: Map<number, WooCategory>) {
  const depth = (id: number) => {
    let level = 0;
    for (let c = categories.get(id); c?.parent && level < 20; c = categories.get(c.parent)) level += 1;
    return level;
  };
  const named = (product.categories || [])
    .map((c) => ({ id: c.id, name: decodeEntities(c.name || '').trim() }))
    .filter((c) => c.name && !/^uncategori[sz]ed$/i.test(c.name));
  if (!named.length) return OTHER_TYPE;
  return named.reduce((best, c) => (depth(c.id) > depth(best.id) ? c : best)).name;
}

/** Shopify's catalog, a few pages at a time until a page comes back short. */
async function shopifyCatalog(origin: string, fetchImpl: Fetch) {
  const products: ShopifyStoreProduct[] = [];
  for (let start = 1; start <= MAX_PAGES; start += PARALLEL) {
    const pages = Array.from({ length: Math.min(PARALLEL, MAX_PAGES - start + 1) }, (_, i) => start + i);
    const batches = await Promise.all(
      pages.map(async (page) => {
        const answer = await getJson(`${origin}/products.json?limit=${SHOPIFY_PER_PAGE}&page=${page}`, fetchImpl);
        if (!answer.ok) throw new HttpError(502, `${new URL(origin).hostname} responded with ${answer.status} for page ${page} of its products`);
        return ((answer.data as { products?: ShopifyStoreProduct[] }).products || []) as ShopifyStoreProduct[];
      }),
    );
    for (const batch of batches) products.push(...batch);
    if (batches.some((batch) => batch.length < SHOPIFY_PER_PAGE)) break;
  }
  // Pages read side by side can overlap when the shop adds a product mid-read.
  const seen = new Set<number>();
  return products.filter((p) => !seen.has(p.id) && seen.add(p.id));
}

/** Every page of a WooCommerce Store API list, PARALLEL pages at a time. */
async function wooPaged<T>(origin: string, path: string, fetchImpl: Fetch): Promise<T[]> {
  const join = path.includes('?') ? '&' : '?';
  const read = async (page: number) => {
    const answer = await getJson(`${origin}/wp-json/wc/store/v1${path}${join}per_page=${WOO_PER_PAGE}&page=${page}`, fetchImpl);
    if (!answer.ok) throw new HttpError(502, `${new URL(origin).hostname} responded with ${answer.status} for ${path} page ${page}`);
    return answer;
  };
  const first = await read(1);
  if (!first.ok) return [];
  const pages = Array.from({ length: Math.min(first.totalPages, WOO_MAX_PAGES) - 1 }, (_, i) => i + 2);
  const rest: T[][] = [];
  for (let i = 0; i < pages.length; i += PARALLEL) {
    const answers = await Promise.all(pages.slice(i, i + PARALLEL).map(read));
    rest.push(...answers.map((a) => (a.ok ? (a.data as T[]) : [])));
  }
  return [first.data as T[], ...rest].flat();
}

async function wooItems(store: StoreInfo, fetchImpl: Fetch) {
  // Products with options (size, colour…) list each option's price separately, as "variation" products.
  const [catalog, categoryList, variationList] = await Promise.all([
    wooPaged<WooProduct>(store.origin, '/products', fetchImpl),
    wooPaged<WooCategory>(store.origin, '/products/categories', fetchImpl).catch(() => []),
    wooPaged<WooVariation>(store.origin, '/products?type=variation', fetchImpl).catch(() => []),
  ]);
  const categories = new Map(categoryList.map((c) => [c.id, c]));
  const variations = new Map(variationList.map((v) => [v.id, v]));
  const items = catalog.map((product): StoreItem | null => {
    const own = (product.variations || []).map((v) => variations.get(v.id)).filter((v): v is WooVariation => Boolean(v));
    const filed = wooType(product, categories);
    const item = wooItem(product, filed === OTHER_TYPE ? typeFromName(decodeEntities(product.name || '')) : filed, own);
    if (!item) return null;
    const { camshamId, ...rest } = item;
    return { ...rest, id: `${store.host}/${camshamId}` };
  });
  return { items, fetched: catalog.length };
}

/**
 * The shop's whole catalog as listable items. `fetched` counts what the shop returned, so the difference is what was
 * skipped (no price or no picture). An empty result is an error, never "everything was removed".
 */
export async function fetchStoreItems(input: string, fetchImpl: Fetch = fetch) {
  const store = await detectStore(input, fetchImpl);
  let fetched: number;
  let list: Array<StoreItem | null>;
  if (store.platform === 'shopify') {
    const catalog = await shopifyCatalog(store.origin, fetchImpl);
    fetched = catalog.length;
    list = catalog.map((product) => shopifyItem(product, store));
  } else {
    ({ items: list, fetched } = await wooItems(store, fetchImpl));
  }
  const items = list.filter((item): item is StoreItem => Boolean(item));
  if (!items.length) throw new HttpError(502, `${store.host} has no products with a price and a picture to import`);
  return { store, items, fetched };
}

/** Downloads one of the shop's pictures on the server (the browser cannot read it across sites). */
export async function fetchStoreImage(url: string, fetchImpl: Fetch = fetch) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new HttpError(400, 'Not a picture address');
  }
  if (parsed.protocol !== 'https:' || !isPublicHost(parsed.hostname)) throw new HttpError(400, 'Only pictures on the public internet can be fetched');
  let res: Response;
  try {
    res = await withRetry(() => fetchImpl(parsed, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(20_000) }));
  } catch (err) {
    throw new HttpError(502, `Could not download the picture (${failureReason(err)})`);
  }
  const type = res.headers.get('content-type') || '';
  if (!res.ok || !type.startsWith('image/')) throw new HttpError(502, `The shop did not return a picture (${res.status})`);
  const body = Buffer.from(await res.arrayBuffer());
  if (body.length > MAX_IMAGE_BYTES) throw new HttpError(502, 'The picture is larger than 15 MB');
  return { type, body };
}
