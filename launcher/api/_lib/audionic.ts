/**
 * Reads Audionic's public Shopify catalog (audionic.co) and turns it into plain items ready to be listed on
 * QuantumStore and Daraz. No database and no Daraz here, so it is unit-tested in tests/audionic.test.ts.
 * Prices stay exactly as Audionic lists them (rupees, no deduction).
 */
import { HttpError } from './http.js';

export const STORE_URL = 'https://audionic.co';
const USER_AGENT = 'QuantumStoreLauncher/1.0 (+https://quantumlogicslimited.com)';
const MAX_IMAGES = 8;
const MAX_SPECS = 30;

type ShopifyVariant = { title: string; price: string; available: boolean };

export type ShopifyProduct = {
  id: number;
  title: string;
  handle: string;
  body_html: string | null;
  product_type: string;
  published_at: string | null;
  variants: ShopifyVariant[];
  images: { src: string }[];
};

export type ProductKind = { type: string; category: string };

export type AudionicVariant = { label: string; pkr: number; available: boolean };

export type AudionicItem = {
  audionicId: string;
  handle: string;
  url: string;
  name: string;
  /** Power Banks, Headphones, Earbuds, Earphones, Speakers or Accessories. */
  type: string;
  /** The QuantumStore category: Audio or Accessories. */
  storeCategory: string;
  description: string;
  specs: Array<{ key: string; value: string }>;
  /** QuantumStore images: cover at 1200 px, its 400 px thumbnail and the other pictures at 1200 px. */
  image: string;
  thumbnail: string;
  images: string[];
  /** The same pictures for Daraz, which only takes JPEG/PNG: Shopify converts on request with `format=jpg`. */
  darazImages: string[];
  /** Only when the product really has options (colour, size…); empty for a single "Default Title" variant. */
  variants: AudionicVariant[];
  /** The lowest listed price in rupees, exactly as audionic.co shows it. */
  pkr: number;
  /** Audionic only says whether an item can be bought, never how many are left. */
  available: boolean;
  publishedAt: string | null;
};

// First keyword match wins; products whose name gives nothing away fall back to Audionic's collections.
const KINDS: Array<ProductKind & { pattern: RegExp; collections: string[] }> = [
  { type: 'Power Banks', category: 'Accessories', pattern: /power\s*bank/i, collections: ['power-bank'] },
  { type: 'Headphones', category: 'Audio', pattern: /head\s*phone/i, collections: ['wireless-headphones'] },
  { type: 'Earbuds', category: 'Audio', pattern: /buds?\b|\btws\b|neckband/i, collections: ['wireless-earbuds', 'tws'] },
  { type: 'Earphones', category: 'Audio', pattern: /earphone/i, collections: ['wired-earphones'] },
  { type: 'Speakers', category: 'Audio', pattern: /speaker|sound\s*bar|home\s*theat|mehfil/i, collections: ['speakers'] },
];
const FALLBACK_KIND: ProductKind = { type: 'Accessories', category: 'Accessories' };

type Fetch = typeof fetch;

async function fetchJson<T>(path: string, fetchImpl: Fetch): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(`${STORE_URL}${path}`, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new HttpError(502, `Could not reach audionic.co: ${(err as Error).message}`);
  }
  if (!res.ok) throw new HttpError(502, `audionic.co responded with ${res.status} for ${path}`);
  return (await res.json()) as T;
}

/** Shopify's public catalog feed, 250 products per page. */
async function fetchCatalog(path: string, fetchImpl: Fetch) {
  const products: ShopifyProduct[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const data = await fetchJson<{ products?: ShopifyProduct[] }>(`${path}?limit=250&page=${page}`, fetchImpl);
    const batch = data.products || [];
    products.push(...batch);
    if (batch.length < 250) break;
  }
  return products;
}

async function classify(products: ShopifyProduct[], fetchImpl: Fetch) {
  const kinds = new Map<number, ProductKind>();
  const unmatched: ShopifyProduct[] = [];
  for (const product of products) {
    const kind = KINDS.find((k) => k.pattern.test(`${product.product_type} ${product.title}`));
    if (kind) kinds.set(product.id, kind);
    else unmatched.push(product);
  }
  if (!unmatched.length) return kinds;

  const handles = [...new Set(KINDS.flatMap((k) => k.collections))];
  const members = new Map(
    await Promise.all(
      handles.map(async (handle) => {
        // A renamed or removed collection only costs us the fallback, not the whole catalog.
        const items = await fetchCatalog(`/collections/${handle}/products.json`, fetchImpl).catch(() => []);
        return [handle, new Set(items.map((item) => item.id))] as const;
      }),
    ),
  );
  for (const product of unmatched) {
    const kind = KINDS.find((k) => k.collections.some((handle) => members.get(handle)?.has(product.id)));
    kinds.set(product.id, kind || FALLBACK_KIND);
  }
  return kinds;
}

/** Shopify's CDN resizes on request; `jpg` also converts, because Daraz does not take webp. */
export function sizedImage(src: string, width: number, jpg = false) {
  const url = new URL(src, 'https://cdn.shopify.com');
  url.searchParams.set('width', String(width));
  if (jpg) url.searchParams.set('format', 'jpg');
  return url.toString();
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  deg: '°',
  times: '×',
  bull: '•',
};

function decodeEntities(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] !== '#') return ENTITIES[code.toLowerCase()] ?? match;
    const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : match;
  });
}

const BOLD_START = '\u0001';
const BOLD_END = '\u0002';

type Line = { kind: 'heading' | 'item' | 'row' | 'para'; text: string; bold: boolean };

const stripTags = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

/** Flatten Shopify body HTML into typed lines: headings, list items, table rows and paragraphs. */
function toLines(html: string): Line[] {
  const marked = html
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    // Table cells often wrap their text in <p>; flatten each row to "cell<TAB>cell" first.
    .replace(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi, (_, row: string) => {
      const cells = [...row.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]\s*>/gi)].map((m) => stripTags(m[1]));
      return `\n${cells.join('\t')}\n`;
    })
    .replace(/<h[1-6]\b[^>]*>/gi, '\n#H#')
    .replace(/<li\b[^>]*>/gi, '\n#LI#')
    .replace(/<\/?(p|div|br|ul|ol|table|tbody|thead|h[1-6]|li|hr)\b[^>]*>/gi, '\n')
    .replace(/<(b|strong)\b[^>]*>/gi, BOLD_START)
    .replace(/<\/(b|strong)\s*>/gi, BOLD_END)
    .replace(/<[^>]*>/g, ' ')
    // Word wraps list text in <p>: keep it on the bullet's line.
    .replace(/(#LI#|#H#)\s*\n+/g, '$1');

  const lines: Line[] = [];
  for (const raw of decodeEntities(marked).split('\n')) {
    let text = raw;
    let kind: Line['kind'] = 'para';
    if (text.startsWith('#H#')) {
      kind = 'heading';
      text = text.slice(3);
    } else if (text.startsWith('#LI#')) {
      kind = 'item';
      text = text.slice(4);
    }
    const cells = text
      .split('\t')
      .map((cell) => clean(cell))
      .filter(Boolean);
    if (cells.length >= 2) {
      lines.push({ kind: 'row', text: cells.join('\t'), bold: false });
      continue;
    }
    const trimmed = text.replace(/\t/g, ' ').trim();
    const bold = trimmed.startsWith(BOLD_START) && trimmed.endsWith(BOLD_END);
    text = clean(trimmed);
    if (text) lines.push({ kind, text, bold });
  }
  return lines;
}

function clean(text: string) {
  return text
    .replace(new RegExp(`[${BOLD_START}${BOLD_END}]`, 'g'), '')
    .replace(/\s+/g, ' ')
    .replace(/^[•·\-–*\s]+/, '')
    .trim();
}

function splitKeyValue(text: string) {
  const match = /^([^:：]{2,40})[:：]\s*(.+)$/.exec(text);
  if (!match || match[1].split(' ').length > 6) return null;
  return { key: match[1].trim(), value: match[2].trim() };
}

const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '');

// Headings that title a whole block rather than name one spec.
const SECTION_TITLE = /^(specs?|specifications?|(technical|product) specifications?|(product )?description|about the product|overview)$/i;
// Audionic ends most descriptions with an FAQ about their own products and store.
const isFaqLine = (text: string) =>
  /^(faqs?|frequently asked questions)\b/i.test(text) || text.endsWith('?') || /^Q\s*[:.)]/i.test(text) || /\?\s*A\s*[:.)]/.test(text);
// Audionic's own store promises (their prices, shipping, returns, checkout) are not ours to make.
const STORE_COPY =
  /\b(buy now|order now|shop now|lowest price|best price|shipping|return policy|customer support|place (an|your) order|your cart|website|cash on delivery|in pakistan)\b/i;
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function truncate(text: string, max: number) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 20)).trim()}…`;
}

/**
 * Audionic's descriptions are mostly "bold heading + bullet list" spec sheets pasted from Word.
 * Turn those into spec rows, and keep any real prose as the plain-text description.
 */
export function parseProductDescription(html: string, title: string) {
  const lines = toLines(html);
  const specs: Array<{ key: string; value: string }> = [];
  const prose: string[] = [];
  const features: string[] = [];
  let heading: { key: string; values: string[]; hasItems: boolean } | null = null;
  const titleKey = normalize(title);

  function addSpec(key: string, value: string) {
    const k = truncate(key.replace(/[:：]\s*$/, '').trim(), 60);
    // "Satellites: Satellites: 3 Inches" → "Satellites: 3 Inches"
    const v = truncate(value.replace(new RegExp(`^${escapeRegExp(k)}\\s*[:：]\\s*`, 'i'), '').trim(), 300);
    if (!k || !v) return;
    const existing = specs.find((s) => s.key.toLowerCase() === k.toLowerCase());
    if (existing) existing.value = truncate(`${existing.value}, ${v}`, 300);
    else if (specs.length < MAX_SPECS) specs.push({ key: k, value: v });
  }

  function flush() {
    if (heading?.values.length) addSpec(heading.key, heading.values.join(', '));
    heading = null;
  }

  for (let i = 0; i < lines.length; i += 1) {
    const { kind, text, bold } = lines[i];
    if (isFaqLine(text)) break;

    const sentence = /[.!?]$/.test(text);
    const headingLike =
      kind === 'heading' ||
      (kind === 'para' && bold && text.length <= 60 && !sentence) ||
      (kind === 'para' && text.length <= 40 && !sentence && !text.includes(':') && lines[i + 1]?.kind === 'item');

    if (kind === 'row') {
      flush();
      const [key, ...values] = text.split('\t');
      addSpec(key, values.join(', '));
      continue;
    }
    if (headingLike) {
      flush();
      const key = normalize(text);
      // The product name repeated as a heading is not a spec group (but "Speaker" in "Max-230 Speaker" is).
      const isTitle = key.includes(titleKey) || (titleKey.includes(key) && key.length * 2 >= titleKey.length);
      if (!isTitle && !SECTION_TITLE.test(text)) heading = { key: text, values: [], hasItems: false };
      continue;
    }

    const pair = text.length <= 150 ? splitKeyValue(text) : null;
    if (kind === 'item') {
      if (heading) {
        heading.values.push(text);
        heading.hasItems = true;
      } else if (pair) addSpec(pair.key, pair.value);
      else features.push(text);
      continue;
    }
    if (pair) {
      flush();
      addSpec(pair.key, pair.value);
      continue;
    }
    // "<b>Display</b>" followed by a plain "LED Display" line, rather than a bullet list.
    if (heading && !heading.hasItems && text.length <= 150 && !sentence) {
      heading.values.push(text);
      continue;
    }
    flush();
    // Real prose only: skip leftover labels/fragments, the product name on its own, and store promises.
    const wordCount = text.split(' ').length;
    if (wordCount >= 10 && normalize(text) !== titleKey && !STORE_COPY.test(text)) prose.push(text);
  }
  flush();
  if (features.length) addSpec('Features', features.join(', '));

  return { description: truncate(prose.join(' '), 1200), specs };
}

/** One catalog entry as a listable item, or null when there is no price above Rs 0 or no picture to show. */
export function toItem(product: ShopifyProduct, kind: ProductKind): AudionicItem | null {
  const variants = product.variants.filter((v) => Number(v.price) > 0);
  const sources = product.images
    .map((img) => img.src)
    .filter((src) => /^(https:)?\/\//i.test(src || ''))
    .slice(0, MAX_IMAGES);
  if (!variants.length || !sources.length) return null;

  const hasOptions = !(product.variants.length === 1 && product.variants[0].title === 'Default Title');
  const name = product.title.trim();
  const { description, specs } = parseProductDescription(product.body_html || '', name);
  const [cover, ...rest] = sources;

  return {
    audionicId: String(product.id),
    handle: product.handle,
    url: `${STORE_URL}/products/${product.handle}`,
    name,
    type: kind.type,
    storeCategory: kind.category,
    description: description || `${name} by Audionic.`,
    specs,
    image: sizedImage(cover, 1200),
    thumbnail: sizedImage(cover, 400),
    images: rest.map((src) => sizedImage(src, 1200)),
    darazImages: sources.map((src) => sizedImage(src, 1200, true)),
    variants: hasOptions
      ? variants.map((v) => ({ label: v.title.trim(), pkr: Number(v.price), available: Boolean(v.available) }))
      : [],
    pkr: Math.min(...variants.map((v) => Number(v.price))),
    available: variants.some((v) => v.available),
    publishedAt: product.published_at || null,
  };
}

/**
 * The whole catalog from audionic.co as listable items. `fetched` counts what Audionic returned, so the
 * difference is what was skipped. An empty result is an error, never "everything was removed".
 */
export async function fetchAudionicItems(fetchImpl: Fetch = fetch) {
  const catalog = await fetchCatalog('/products.json', fetchImpl);
  const kinds = await classify(catalog, fetchImpl);
  const items = catalog
    .map((product) => toItem(product, kinds.get(product.id) || FALLBACK_KIND))
    .filter((item): item is AudionicItem => Boolean(item));
  if (!items.length) throw new HttpError(502, 'audionic.co returned no products to import');
  return { items, fetched: catalog.length };
}
