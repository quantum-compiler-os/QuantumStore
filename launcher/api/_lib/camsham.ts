/**
 * Reads CamSham's public WooCommerce catalog (camsham.pk, Store API) and turns it into plain items ready to be listed on
 * QuantumStore and Daraz. No database and no Daraz here, so it is unit-tested in tests/camsham.test.ts.
 * Prices stay exactly as CamSham lists them (rupees, no deduction).
 */
import { decodeEntities, parseProductDescription, type AudionicVariant } from './audionic.js';
import { HttpError } from './http.js';

export const STORE_URL = 'https://camsham.pk';
const API = '/wp-json/wc/store/v1';
const USER_AGENT = 'QuantumStoreLauncher/1.0 (+https://quantumlogicslimited.com)';
const PER_PAGE = 100;
const MAX_PAGES = 40;
const MAX_IMAGES = 8;
const MAX_SPECS = 30;
const PARALLEL = 6;

type WooPrices = { price: string; currency_minor_unit: number };
type WooImage = { src: string; thumbnail?: string };
type WooAttribute = { name: string; has_variations: boolean; terms: Array<{ name: string }> };

export type WooProduct = {
  id: number;
  name: string;
  type: string;
  permalink: string;
  short_description: string;
  description: string;
  prices: WooPrices;
  images: WooImage[];
  categories: Array<{ id: number; name: string }>;
  brands?: Array<{ name: string }>;
  attributes: WooAttribute[];
  variations: Array<{ id: number; attributes: Array<{ name: string; value: string }> }>;
  is_in_stock: boolean;
  is_purchasable: boolean;
};

export type WooVariation = { id: number; prices: WooPrices; is_in_stock: boolean; is_purchasable: boolean };

export type WooCategory = { id: number; name: string; parent: number };

export type CamshamItem = {
  camshamId: string;
  url: string;
  name: string;
  brand: string;
  /** What kind of product it is (Lenses, Tripods, Microphones…): one Daraz category is chosen per type. */
  type: string;
  /** The QuantumStore category until a Daraz category is chosen (the page then uses the Daraz one). */
  storeCategory: string;
  description: string;
  specs: Array<{ key: string; value: string }>;
  /** CamSham's own picture addresses; the Launcher copies them to QuantumStore's storage before listing. */
  image: string;
  thumbnail: string;
  images: string[];
  darazImages: string[];
  variants: AudionicVariant[];
  /** The lowest price in rupees, exactly as camsham.pk shows it. */
  pkr: number;
  available: boolean;
};

// CamSham's sub-categories that say what a product is. Brand sub-categories ("Canon" under Lenses) are not here,
// so those products take their top-level category's type below.
const TYPE_BY_CATEGORY: Record<string, string> = {
  'action camera': 'Action Cameras',
  drones: 'Drones',
  adaptors: 'Lens Adaptors',
  'camera flash': 'Camera Flashes',
  triggers: 'Flash Triggers',
  'led & studio lights': 'Studio Lights',
  'ring lights & panal lights': 'Ring Lights',
  'softbox & umbrella': 'Softboxes & Umbrellas',
  batteries: 'Batteries',
  chargers: 'Chargers',
  filter: 'Lens Filters',
  'lens hood': 'Lens Hoods',
  monitors: 'Camera Monitors',
  'silicon covers': 'Camera Covers',
  strap: 'Camera Straps',
  'card case': 'Memory Card Cases',
  'card readers': 'Card Readers',
  'flash drives': 'Flash Drives',
  'hard drives': 'Hard Drives',
  'sd cards': 'Memory Cards',
  powerbank: 'Power Banks',
};

const TYPE_BY_TOP_CATEGORY: Record<string, string> = {
  cameras: 'Cameras',
  lenses: 'Lenses',
  audio: 'Microphones',
  tripod: 'Tripods',
  'camera & mobile gimbals': 'Gimbals',
  bags: 'Camera Bags',
  'lighting equipments': 'Lighting',
  'memory cards & external hard drives': 'Memory Cards',
  accessories: 'Camera Accessories',
  'mobile accessories': 'Mobile Accessories',
};

// Products only filed under "New Arrival", "Creators Special", "BUNDLE DEALS"… are typed by their name. First match wins.
const TYPE_BY_NAME: Array<{ pattern: RegExp; type: string }> = [
  { pattern: /\bflash\b/i, type: 'Camera Flashes' },
  { pattern: /\blight|\bstand\b|softbox/i, type: 'Lighting' },
  { pattern: /gimbal/i, type: 'Gimbals' },
  { pattern: /tripod|selfie stick/i, type: 'Tripods' },
  { pattern: /\bmic(rophone)?s?\b/i, type: 'Microphones' },
  { pattern: /\bbag\b|backpack/i, type: 'Camera Bags' },
  { pattern: /\bcells?\b|batter(y|ies)/i, type: 'Batteries' },
];
const FALLBACK_TYPE = 'Camera Accessories';

const categoryKey = (name: string) => decodeEntities(name).trim().toLowerCase();

/** The product's type from its CamSham categories (most specific first), then from its name. */
export function typeOf(product: Pick<WooProduct, 'name' | 'categories'>, categories: Map<number, WooCategory>) {
  let fromTop: string | null = null;
  for (const category of product.categories) {
    const specific = TYPE_BY_CATEGORY[categoryKey(category.name)];
    if (specific) return specific;
    let top = categories.get(category.id);
    while (top?.parent && categories.has(top.parent)) top = categories.get(top.parent);
    fromTop ??= TYPE_BY_TOP_CATEGORY[categoryKey(top?.name ?? category.name)] ?? null;
  }
  if (fromTop) return fromTop;
  const name = decodeEntities(product.name);
  return TYPE_BY_NAME.find((rule) => rule.pattern.test(name))?.type ?? FALLBACK_TYPE;
}

const rupees = (prices: WooPrices | undefined) => {
  const value = Number(prices?.price) / 10 ** (prices?.currency_minor_unit ?? 0);
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : 0;
};

// CamSham files warranty terms under "brands" ("1 Year Warranty"); those are not brands.
const brandOf = (product: Pick<WooProduct, 'brands'>) =>
  (product.brands || []).map((b) => decodeEntities(b.name).trim()).find((name) => name && !/warrant/i.test(name)) || 'No Brand';

const isWebUrl = (src: string | undefined): src is string => /^https:\/\//i.test(src || '');

/** One catalog entry as a listable item, or null when there is no price above Rs 0 or no picture to show. */
export function toItem(product: WooProduct, type: string, variations: WooVariation[] = []): CamshamItem | null {
  const pictures = product.images.filter((img) => isWebUrl(img.src)).slice(0, MAX_IMAGES);
  const labels = new Map(product.variations.map((v) => [v.id, v.attributes.map((a) => a.value).join(' / ')]));
  const variants = variations
    .map((v) => ({ label: labels.get(v.id) || String(v.id), pkr: rupees(v.prices), available: v.is_in_stock && v.is_purchasable }))
    .filter((v) => v.pkr > 0 && v.label);
  const pkr = variants.length ? Math.min(...variants.map((v) => v.pkr)) : rupees(product.prices);
  if (!pkr || !pictures.length) return null;

  const name = decodeEntities(product.name).replace(/\s+price in pakistan\s*$/i, '').trim();
  const parsed = parseProductDescription(`${product.short_description || ''}\n${product.description || ''}`, name);
  const specs = [...parsed.specs];
  for (const attribute of product.attributes || []) {
    const value = attribute.terms.map((t) => decodeEntities(t.name)).join(', ');
    if (attribute.has_variations || !value || specs.length >= MAX_SPECS) continue;
    if (!specs.some((s) => s.key.toLowerCase() === attribute.name.toLowerCase())) specs.push({ key: decodeEntities(attribute.name), value });
  }
  const [cover, ...rest] = pictures;

  return {
    camshamId: String(product.id),
    url: product.permalink,
    name,
    brand: brandOf(product),
    type,
    storeCategory: type,
    description: parsed.description || `${name}.`,
    specs,
    image: cover.src,
    thumbnail: isWebUrl(cover.thumbnail) ? cover.thumbnail : cover.src,
    images: rest.map((img) => img.src),
    darazImages: pictures.map((img) => img.src),
    variants,
    pkr,
    available: variants.length ? variants.some((v) => v.available) : product.is_in_stock && product.is_purchasable,
  };
}

type Fetch = typeof fetch;

async function fetchJson<T>(path: string, fetchImpl: Fetch): Promise<{ data: T; totalPages: number }> {
  let res: Response;
  try {
    res = await fetchImpl(`${STORE_URL}${API}${path}`, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new HttpError(502, `Could not reach camsham.pk: ${(err as Error).message}`);
  }
  if (!res.ok) throw new HttpError(502, `camsham.pk responded with ${res.status} for ${path}`);
  return { data: (await res.json()) as T, totalPages: Number(res.headers.get('x-wp-totalpages')) || 1 };
}

/** Runs `fn` over `list` with at most PARALLEL requests in flight, keeping the order. */
async function inBatches<T, R>(list: T[], fn: (value: T) => Promise<R>) {
  const out: R[] = [];
  for (let i = 0; i < list.length; i += PARALLEL) out.push(...(await Promise.all(list.slice(i, i + PARALLEL).map(fn))));
  return out;
}

async function fetchPaged<T>(path: string, fetchImpl: Fetch) {
  const join = path.includes('?') ? '&' : '?';
  const first = await fetchJson<T[]>(`${path}${join}per_page=${PER_PAGE}&page=1`, fetchImpl);
  const pages = Array.from({ length: Math.min(first.totalPages, MAX_PAGES) - 1 }, (_, i) => i + 2);
  const rest = await inBatches(pages, async (page) => (await fetchJson<T[]>(`${path}${join}per_page=${PER_PAGE}&page=${page}`, fetchImpl)).data);
  return [first.data, ...rest].flat();
}

/**
 * The whole catalog from camsham.pk as listable items. `fetched` counts what CamSham returned, so the difference is
 * what was skipped (no price or no picture). An empty result is an error, never "everything was removed".
 */
export async function fetchCamshamItems(fetchImpl: Fetch = fetch) {
  // Products with options (storage size…) list each option's price separately, as "variation" products.
  const [catalog, categoryList, variationList] = await Promise.all([
    fetchPaged<WooProduct>('/products', fetchImpl),
    fetchPaged<WooCategory>('/products/categories', fetchImpl),
    fetchPaged<WooVariation>('/products?type=variation', fetchImpl),
  ]);
  const categories = new Map(categoryList.map((c) => [c.id, c]));
  const variations = new Map(variationList.map((v) => [v.id, v]));

  const items = catalog
    .map((product) =>
      toItem(
        product,
        typeOf(product, categories),
        product.variations.map((v) => variations.get(v.id)).filter((v): v is WooVariation => Boolean(v)),
      ),
    )
    .filter((item): item is CamshamItem => Boolean(item));
  if (!items.length) throw new HttpError(502, 'camsham.pk returned no products to import');
  return { items, fetched: catalog.length };
}

/** Only CamSham's own upload folder may be fetched through the Launcher. */
export function isCamshamImage(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && /(^|\.)camsham\.pk$/i.test(parsed.hostname) && parsed.pathname.startsWith('/wp-content/uploads/');
  } catch {
    return false;
  }
}

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

/** Downloads one CamSham picture on the server (the browser cannot read it across sites). */
export async function fetchCamshamImage(url: string, fetchImpl: Fetch = fetch) {
  if (!isCamshamImage(url)) throw new HttpError(400, 'Only camsham.pk product pictures can be fetched');
  let res: Response;
  try {
    res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(20_000) });
  } catch (err) {
    throw new HttpError(502, `Could not download the picture: ${(err as Error).message}`);
  }
  const type = res.headers.get('content-type') || '';
  if (!res.ok || !type.startsWith('image/')) throw new HttpError(502, `camsham.pk did not return a picture (${res.status})`);
  const body = Buffer.from(await res.arrayBuffer());
  if (body.length > MAX_IMAGE_BYTES) throw new HttpError(502, 'The picture is larger than 15 MB');
  return { type, body };
}
