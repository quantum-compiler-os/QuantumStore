/**
 * Reads PakBooks' public Shopify catalog (pakbooks.com) and turns it into plain items ready to be listed on
 * QuantumStore and Daraz. No database and no Daraz here, so it is unit-tested in tests/pakbooks.test.ts.
 * Prices stay exactly as PakBooks lists them (rupees, no deduction).
 */
import { decodeEntities, parseProductDescription, sizedImage, type AudionicVariant } from './audionic.js';
import { HttpError } from './http.js';
import { failureReason, withRetry } from './net.js';

export const STORE_URL = 'https://www.pakbooks.com';
const USER_AGENT = 'QuantumStoreLauncher/1.0 (+https://quantumlogicslimited.com)';
const PER_PAGE = 250;
/** PakBooks has about 9,000 books (36 pages); this leaves room to grow. */
const MAX_PAGES = 80;
/** Pages read at once: quick, without tripping Shopify's rate limit. */
const PARALLEL = 4;
const MAX_IMAGES = 6;

export type PakbooksProduct = {
  id: number;
  title: string;
  handle: string;
  body_html: string | null;
  vendor: string;
  tags: string[];
  variants: Array<{ title: string; price: string; available: boolean; grams?: number }>;
  images: Array<{ src: string }>;
};

export type PakbooksItem = {
  pakbooksId: string;
  url: string;
  name: string;
  /** The writer (PakBooks files it as the "vendor"). Not a Daraz brand: books are listed as No Brand. */
  author: string;
  /** What kind of book it is (Fiction, Islam & Religion…), from PakBooks' tags: one Daraz category is chosen per type. */
  type: string;
  storeCategory: string;
  description: string;
  specs: Array<{ key: string; value: string }>;
  image: string;
  thumbnail: string;
  images: string[];
  darazImages: string[];
  variants: AudionicVariant[];
  pkr: number;
  available: boolean;
};

export const GENERAL_TYPE = 'Books';

// PakBooks' tags are its collection names. The most specific one decides the type (first match in this list wins);
// marketing tags (best sellers, bundle offers…) say nothing about the book and are not here.
const TYPE_BY_TITLE: Array<[RegExp, string]> = [
  [/\b(qur'?an|quran|tafs[ei]e?r|tafaseer)\b/i, 'Quran & Tafseer'],
  [/\b(hadith|ahadith|sahih|seerat|seerah|sirat)\b/i, 'Hadith & Seerat'],
];

const TYPE_BY_TAG: Array<[string, string]> = [
  ['quran-tafaseer', 'Quran & Tafseer'],
  ['pakbooks-quran-series', 'Quran & Tafseer'],
  ['hadith-seerat', 'Hadith & Seerat'],
  ['kids-books-sets', "Children's Books"],
  ['childrens-books', "Children's Books"],
  ['get-ready-for-school', "Children's Books"],
  ['o-level-a-level-books', 'Textbooks'],
  ['school-textbooks', 'Textbooks'],
  ['teaching-resources-education', 'Education'],
  ['education', 'Education'],
  ['books-by-dr-israr-ahmed', 'Islam & Religion'],
  ['sufism', 'Islam & Religion'],
  ['islam', 'Islam & Religion'],
  ['religion', 'Islam & Religion'],
  ['iqbaliyat', 'Poetry & Drama'],
  ['poetry-drama', 'Poetry & Drama'],
  ['biography', 'Biography'],
  ['travelogue', 'Travel'],
  ['humour', 'Humour'],
  ['romance', 'Fiction'],
  ['fiction', 'Fiction'],
  ['history-politics', 'History & Politics'],
  ['literary-criticism-languages', 'Literature & Languages'],
  ['self-help', 'Self-Help'],
  ['mind-body-spirit', 'Self-Help'],
  ['medical', 'Health & Medicine'],
  ['health', 'Health & Medicine'],
  ['computing', 'Science & Technology'],
  ['technology-engineering', 'Science & Technology'],
  ['science-geography', 'Science & Technology'],
  ['business-finance-law', 'Business & Law'],
  ['law-jurisprudence', 'Business & Law'],
  ['economics', 'Philosophy & Social Sciences'],
  ['mass-communication', 'Philosophy & Social Sciences'],
  ['philosophy-social-sciences', 'Philosophy & Social Sciences'],
  ['art-photography', 'Art & Photography'],
  ['food-drink', 'Cooking'],
  ['reference', 'Reference'],
];

/** The book's type from its tags; untagged books are plain "Books". */
export function typeOf(tags: string[], title = '') {
  // PakBooks' tags are sometimes missing or wrong (a Quran translation tagged "fiction"); a title that plainly says
  // what the book is wins.
  const byTitle = TYPE_BY_TITLE.find(([pattern]) => pattern.test(title))?.[1];
  if (byTitle) return byTitle;
  const own = new Set(tags.map((t) => t.trim().toLowerCase()));
  return TYPE_BY_TAG.find(([tag]) => own.has(tag))?.[1] ?? GENERAL_TYPE;
}

/** Too little text to tell the language from (a stray word, or only HTML tags). */
const MIN_LANGUAGE_LETTERS = 20;

/** Urdu (Arabic script) or English, from the description's words (not its HTML tags); unknown without enough text. */
export function languageOf(html: string) {
  const text = html.replace(/<[^>]*>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ');
  const urdu = (text.match(/[؀-ۿ]/g) || []).length;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  if (urdu + latin < MIN_LANGUAGE_LETTERS) return null;
  return urdu > latin ? 'Urdu' : 'English';
}

const isWebUrl = (src: string | undefined) => /^(https:)?\/\//i.test(src || '');

/** One catalog entry as a listable item, or null when there is no price above Rs 0 or no picture to show. */
export function toItem(product: PakbooksProduct): PakbooksItem | null {
  const variant = product.variants.find((v) => Number(v.price) > 0);
  const sources = product.images.map((img) => img.src).filter(isWebUrl).slice(0, MAX_IMAGES);
  if (!variant || !sources.length) return null;

  const name = decodeEntities(product.title).replace(/\s+/g, ' ').trim();
  const author = decodeEntities(product.vendor || '').replace(/\s+/g, ' ').trim();
  const parsed = parseProductDescription(product.body_html || '', name);
  const specs = [...parsed.specs];
  const addSpec = (key: string, value: string | null | undefined) => {
    if (value && !specs.some((s) => s.key.toLowerCase() === key.toLowerCase())) specs.push({ key, value });
  };
  addSpec('Author', author);
  addSpec('Language', languageOf(product.body_html || ''));
  addSpec('Format', 'Book');
  // Shopify's shipping weight, so Daraz's package weight starts from the real one.
  if (variant.grams && variant.grams > 0) addSpec('Weight', `${variant.grams} g`);

  const type = typeOf(product.tags || [], product.title);
  const [cover, ...rest] = sources;
  return {
    pakbooksId: String(product.id),
    url: `${STORE_URL}/products/${product.handle}`,
    name,
    author,
    type,
    storeCategory: type,
    description: parsed.description || `${name}${author ? ` by ${author}` : ''}.`,
    specs,
    image: sizedImage(cover, 1200),
    thumbnail: sizedImage(cover, 400),
    images: rest.map((src) => sizedImage(src, 1200)),
    // Daraz only takes JPEG/PNG; Shopify converts on request.
    darazImages: sources.map((src) => sizedImage(src, 1200, true)),
    variants: [],
    pkr: Number(variant.price),
    available: product.variants.some((v) => v.available && Number(v.price) > 0),
  };
}

type Fetch = typeof fetch;

async function fetchPage(page: number, fetchImpl: Fetch): Promise<PakbooksProduct[]> {
  const path = `/products.json?limit=${PER_PAGE}&page=${page}`;
  let res: Response;
  try {
    res = await withRetry(
      async () => {
        const answer = await fetchImpl(`${STORE_URL}${path}`, {
          headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
          signal: AbortSignal.timeout(20_000),
        });
        // Shopify's rate limit: worth one more try after the pause.
        if (answer.status === 429) throw Object.assign(new Error('rate limited (429)'), { answer });
        return answer;
      },
      { retries: 2, delayMs: 1_500 },
    );
  } catch (err) {
    const answer = (err as { answer?: Response }).answer;
    if (answer) res = answer;
    else throw new HttpError(502, `Could not reach pakbooks.com (${failureReason(err)}) — check your connection and try again`);
  }
  if (!res.ok) throw new HttpError(502, `pakbooks.com responded with ${res.status} for ${path}`);
  return ((await res.json()) as { products?: PakbooksProduct[] }).products || [];
}

/** Every product in PakBooks' catalog feed, a few pages at a time until a page comes back short. */
async function fetchCatalog(fetchImpl: Fetch) {
  const products: PakbooksProduct[] = [];
  for (let start = 1; start <= MAX_PAGES; start += PARALLEL) {
    const pages = Array.from({ length: Math.min(PARALLEL, MAX_PAGES - start + 1) }, (_, i) => start + i);
    const batches = await Promise.all(pages.map((page) => fetchPage(page, fetchImpl)));
    for (const batch of batches) products.push(...batch);
    if (batches.some((batch) => batch.length < PER_PAGE)) break;
  }
  // Pages read side by side can overlap when PakBooks adds a book mid-read.
  const seen = new Set<number>();
  return products.filter((p) => !seen.has(p.id) && seen.add(p.id));
}

/** PakBooks' own files on Shopify's CDN (its store folder), or on pakbooks.com: the only pictures the Launcher fetches. */
const SHOPIFY_FOLDER = '/s/files/1/0062/6468/4628/';

export function isPakbooksImage(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    if (parsed.hostname === 'cdn.shopify.com') return parsed.pathname.startsWith(SHOPIFY_FOLDER);
    return /^(www\.)?pakbooks\.com$/i.test(parsed.hostname) && parsed.pathname.startsWith('/cdn/shop/');
  } catch {
    return false;
  }
}

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

/** Downloads one PakBooks picture on the server (so the browser can turn it into a JPEG Daraz accepts). */
export async function fetchPakbooksImage(url: string, fetchImpl: Fetch = fetch) {
  if (!isPakbooksImage(url)) throw new HttpError(400, 'Only PakBooks product pictures can be fetched');
  let res: Response;
  try {
    res = await withRetry(() => fetchImpl(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(20_000) }));
  } catch (err) {
    throw new HttpError(502, `Could not download the picture (${failureReason(err)})`);
  }
  const type = res.headers.get('content-type') || '';
  if (!res.ok || !type.startsWith('image/')) throw new HttpError(502, `PakBooks did not return a picture (${res.status})`);
  const body = Buffer.from(await res.arrayBuffer());
  if (body.length > MAX_IMAGE_BYTES) throw new HttpError(502, 'The picture is larger than 15 MB');
  return { type, body };
}

/**
 * The whole catalog from pakbooks.com as listable items. `fetched` counts what PakBooks returned, so the difference is
 * what was skipped (no price or no picture). An empty result is an error, never "everything was removed".
 */
export async function fetchPakbooksItems(fetchImpl: Fetch = fetch) {
  const catalog = await fetchCatalog(fetchImpl);
  const items = catalog.map(toItem).filter((item): item is PakbooksItem => Boolean(item));
  if (!items.length) throw new HttpError(502, 'pakbooks.com returned no products to import');
  return { items, fetched: catalog.length };
}
