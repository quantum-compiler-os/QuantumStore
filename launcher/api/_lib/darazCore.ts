/**
 * Pure helpers for the Daraz Open Platform (Lazada-family) API. No network, no env, so they
 * are unit-tested in tests/darazCore.test.ts. Contract notes (verify against open.daraz.com
 * if Daraz rejects a call): requests are signed with HMAC-SHA256 over
 * `<apiPath><key1><value1><key2><value2>…` (keys sorted ascending, apiPath without /rest),
 * rendered as uppercase hex; product/image calls take their body as an XML `payload` field.
 */
import { createHmac } from 'node:crypto';
import { isBrandNotAuthorized } from '../../shared/darazText.js';

export type DarazAttribute = {
  name: string;
  label: string;
  mandatory: boolean;
  inputType: string;
  /** `sku` attributes (colour, size…) live inside <Sku>; everything else inside <Attributes>. */
  attributeType: 'normal' | 'sku';
  options: string[];
};

export type DarazCategoryLeaf = { id: number; name: string; path: string };

export type DarazProductInput = {
  categoryId: number;
  name: string;
  description: string;
  shortDescription?: string;
  /** Daraz-hosted address of the cover image, shown at the top of the description. */
  descriptionImage?: string;
  brand: string;
  sellerSku: string;
  quantity: number;
  price: number;
  specialPrice?: number | null;
  images: string[];
  package: { weight: number; length: number; width: number; height: number; content: string };
  /** Extra category attributes the seller filled in, keyed by Daraz attribute name. */
  attributes: Record<string, string>;
};

/** Daraz's own placeholder brand; always accepted. */
export const NO_BRAND = 'No Brand';

/**
 * Daraz only takes brands from its own list. When the category lists its brand options, the seller's brand is
 * matched against them (ignoring case and spacing) and replaced by "No Brand" if it is not there. When no list
 * is given the brand is passed on and `isRejectedValue` below catches a refusal.
 */
export function resolveBrand(brand: string, options: string[] = []) {
  const wanted = brand.trim();
  if (!wanted) return NO_BRAND;
  if (!options.length) return wanted;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return options.find((o) => norm(o) === norm(wanted)) ?? NO_BRAND;
}

/** Daraz's "value is not in the dropdown" error names the offending value, e.g. `…Zia ul Quran[-1]`. */
export function isRejectedValue(message: string, value: string) {
  return Boolean(value.trim()) && message.toLowerCase().includes(value.trim().toLowerCase());
}

/**
 * A listing is retried once as "No Brand" when Daraz refuses the brand: either because it is not on Daraz's list
 * (the error names it) or because the seller account is not authorized to sell it (Daraz's brand policy).
 */
export function shouldRetryAsNoBrand(message: string, brand: string) {
  return brand !== NO_BRAND && (isBrandNotAuthorized(message) || isRejectedValue(message, brand));
}

/** Attributes the launcher fills from the core form, so they are never asked for twice. */
export const AUTO_ATTRIBUTES = new Set([
  'name',
  'description',
  'short_description',
  'brand',
  'price',
  'special_price',
  'quantity',
  'SellerSku',
  'package_weight',
  'package_length',
  'package_width',
  'package_height',
  'package_content',
]);

/**
 * Pulls the authorization code out of whatever the seller pasted: the bare code, or the full
 * address Daraz redirected to (`…?code=…&state=…`). Returns null when nothing usable is found.
 */
export function extractAuthCode(input: string): string | null {
  const text = String(input || '').trim();
  if (!text) return null;
  const fromQuery = /[?&]code=([^&#\s]+)/.exec(text)?.[1];
  const candidate = fromQuery ? decodeURIComponent(fromQuery) : text;
  return /^[\w.\-~]{6,200}$/.test(candidate) ? candidate : null;
}

export function signRequest(apiPath: string, params: Record<string, string>, secret: string) {
  const base = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], apiPath);
  return createHmac('sha256', secret).update(base, 'utf8').digest('hex').toUpperCase();
}

export function xmlEscape(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Element names come from Daraz attribute names; refuse anything that is not a plain tag name. */
function checkTagName(name: string) {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) throw new Error(`Invalid Daraz attribute name: ${name}`);
}

function tag(name: string, value: string) {
  checkTagName(name);
  return `<${name}>${xmlEscape(value)}</${name}>`;
}

function htmlTag(name: string, html: string) {
  checkTagName(name);
  return `<${name}><![CDATA[${html.replace(/\]\]>/g, ']]]]><![CDATA[>')}]]></${name}>`;
}

function imagesXml(urls: string[]) {
  return `<Images>${urls.map((u) => `<Image>${xmlEscape(u)}</Image>`).join('')}</Images>`;
}

function htmlEscape(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function plainTextToHtml(text: string) {
  return htmlEscape(text).replace(/\r?\n/g, '<br/>');
}

const HAS_HTML = /<[a-z][\s\S]*>/i;

/** Category attributes that hold formatted text (English description, highlights) rather than a plain value. */
export function isRichTextAttribute(name: string, inputType = '') {
  return inputType === 'richText' || /(^|_)description/i.test(name);
}

/**
 * Form values are plain text. Highlights ("short_description…") become a bullet list, one bullet per line;
 * descriptions keep their line breaks. A value that already holds HTML is sent as it is.
 */
export function richTextToHtml(name: string, value: string) {
  if (HAS_HTML.test(value)) return value;
  if (/short_description|highlight/i.test(name)) {
    const items = value
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*[-•*]\s*/, '').trim())
      .filter(Boolean);
    return `<ul>${items.map((item) => `<li>${htmlEscape(item)}</li>`).join('')}</ul>`;
  }
  return plainTextToHtml(value);
}

export function specsToHtml(specs: Array<{ key: string; value: string }>) {
  if (!specs.length) return '';
  const items = specs.map((s) => `<li>${htmlEscape(s.key)}: ${htmlEscape(s.value)}</li>`).join('');
  return `<ul>${items}</ul>`;
}

/** The description text, with the cover image above it when one is given. */
function descriptionHtml(input: Pick<DarazProductInput, 'description' | 'descriptionImage'>) {
  const image = input.descriptionImage
    ? `<p><img src="${xmlEscape(input.descriptionImage)}" style="max-width:100%"/></p>`
    : '';
  return image + plainTextToHtml(input.description);
}

export function buildProductXml(input: DarazProductInput, meta: DarazAttribute[] = []) {
  const skuNames = new Set(meta.filter((a) => a.attributeType === 'sku').map((a) => a.name));
  const inputTypes = new Map(meta.map((a) => [a.name, a.inputType]));
  const productAttrs: string[] = [
    tag('name', input.name),
    htmlTag('description', descriptionHtml(input)),
    htmlTag('short_description', input.shortDescription || plainTextToHtml(input.description.slice(0, 500))),
    tag('brand', input.brand || 'No Brand'),
  ];
  const skuAttrs: string[] = [];

  for (const [name, value] of Object.entries(input.attributes)) {
    if (!value || AUTO_ATTRIBUTES.has(name)) continue;
    const xml = isRichTextAttribute(name, inputTypes.get(name))
      ? htmlTag(name, richTextToHtml(name, value))
      : tag(name, value);
    (skuNames.has(name) ? skuAttrs : productAttrs).push(xml);
  }

  const pkg = input.package;
  const sku = [
    tag('SellerSku', input.sellerSku),
    ...skuAttrs,
    tag('quantity', String(input.quantity)),
    tag('price', input.price.toFixed(2)),
    ...(input.specialPrice != null && input.specialPrice > 0 && input.specialPrice < input.price
      ? [tag('special_price', input.specialPrice.toFixed(2))]
      : []),
    tag('package_weight', String(pkg.weight)),
    tag('package_length', String(pkg.length)),
    tag('package_width', String(pkg.width)),
    tag('package_height', String(pkg.height)),
    tag('package_content', pkg.content),
    imagesXml(input.images),
  ].join('');

  return (
    '<?xml version="1.0" encoding="UTF-8" ?>' +
    `<Request><Product><PrimaryCategory>${input.categoryId}</PrimaryCategory>` +
    `${imagesXml(input.images)}<Attributes>${productAttrs.join('')}</Attributes>` +
    `<Skus><Sku>${sku}</Sku></Skus></Product></Request>`
  );
}

export function buildImageMigrateXml(url: string) {
  return `<?xml version="1.0" encoding="UTF-8" ?><Request><Image><Url>${xmlEscape(url)}</Url></Image></Request>`;
}

/** Replaces the images of an existing item's SKU (Daraz "SetImages", which wants the SkuId, not the seller SKU). */
export function buildSetImagesXml(skuId: string, urls: string[]) {
  return (
    '<?xml version="1.0" encoding="UTF-8" ?>' +
    `<Request><Product><Skus><Sku>${tag('SkuId', skuId)}${imagesXml(urls)}</Sku></Skus></Product></Request>`
  );
}

/**
 * Changes the price and/or stock of an existing item's SKU (Daraz "UpdatePriceQuantity"). Like SetImages it is
 * addressed by item id + SKU id, never by seller SKU. A field left out is left as it is on Daraz.
 */
export function buildPriceQuantityXml(listing: { itemId: string; skuId: string }, change: { price?: number; quantity?: number }) {
  const fields =
    (change.price !== undefined ? tag('Price', String(change.price)) : '') +
    (change.quantity !== undefined ? tag('Quantity', String(change.quantity)) : '');
  return (
    '<?xml version="1.0" encoding="UTF-8" ?>' +
    `<Request><Product><Skus><Sku>${tag('ItemId', listing.itemId)}${tag('SkuId', listing.skuId)}${fields}</Sku></Skus></Product></Request>`
  );
}

/** One live Daraz item as the sync sees it (the first SKU stands for the item, as everywhere else in the Launcher). */
export type DarazItem = {
  itemId: string;
  skuId: string;
  sellerSku: string;
  name: string;
  /** Daraz keeps HTML here; see htmlToText. */
  description: string;
  brand: string;
  categoryId: number;
  /** The selling price on Daraz, commission included. */
  price: number;
  quantity: number;
  images: string[];
};

const text = (value: unknown) => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '');

/**
 * Reads the products of Daraz "GetProducts" into DarazItem rows. Deleted items and items without a SKU are left out.
 * The response spells some fields in different cases (`SkuId`/`sku_id`), so each is looked up defensively.
 */
export function normalizeDarazProducts(products: unknown): DarazItem[] {
  const out: DarazItem[] = [];
  for (const raw of Array.isArray(products) ? (products as Array<Record<string, any>>) : []) {
    const skus: Array<Record<string, any>> = Array.isArray(raw?.skus) ? raw.skus : [];
    const sku = skus.find((s) => String(s?.Status ?? s?.status ?? '').toLowerCase() !== 'deleted');
    const itemId = text(raw?.item_id);
    if (!itemId || !sku) continue;
    const attributes = (raw.attributes || {}) as Record<string, unknown>;
    const images = [...(Array.isArray(sku.Images) ? sku.Images : []), ...(Array.isArray(raw.images) ? raw.images : [])]
      .map(text)
      .filter((url) => url.startsWith('http'));
    out.push({
      itemId,
      skuId: text(sku.SkuId ?? sku.sku_id),
      sellerSku: text(sku.SellerSku ?? sku.seller_sku),
      name: text(attributes.name).trim(),
      description: text(attributes.description) || text(attributes.short_description),
      brand: text(attributes.brand).trim(),
      categoryId: Number(raw.primary_category) || 0,
      price: Number(sku.price) || 0,
      quantity: Number(sku.quantity ?? sku.Available) || 0,
      images: [...new Set(images)],
    });
  }
  return out;
}

/** Daraz descriptions are HTML; the store shows plain text, so tags are dropped and the line breaks kept. */
export function htmlToText(html: string) {
  return html
    .replace(/<\s*(br|\/p|\/li|\/div|\/h[1-6])\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

type RawCategory ={ category_id: number; name: string; leaf?: boolean; children?: RawCategory[] };

/**
 * The parameter sets to try, in order, for removing an item (Daraz "RemoveProduct"). Daraz has been retiring the
 * seller SKU in favour of the SKU id, so that is tried first and the seller SKU is the fallback.
 */
export function removeProductAttempts(listing: { itemId: string; skuId: string; sellerSku: string }) {
  const attempts: Array<Record<string, string>> = [];
  if (listing.skuId) attempts.push({ sku_id_list: JSON.stringify([`SkuId_${listing.itemId}_${listing.skuId}`]) });
  attempts.push({ seller_sku_list: JSON.stringify([listing.sellerSku]) });
  return attempts;
}

export function flattenCategoryTree(tree: RawCategory[], trail: string[] = []): DarazCategoryLeaf[] {
  const out: DarazCategoryLeaf[] = [];
  for (const node of tree || []) {
    const path = [...trail, node.name];
    if (node.leaf || !node.children?.length) {
      out.push({ id: Number(node.category_id), name: node.name, path: path.join(' › ') });
    } else {
      out.push(...flattenCategoryTree(node.children, path));
    }
  }
  return out;
}

type RawAttribute = {
  name: string;
  label?: string;
  input_type?: string;
  is_mandatory?: number | boolean | string;
  attribute_type?: string;
  options?: Array<{ name?: string; en_name?: string }>;
};

export function normalizeAttributes(raw: RawAttribute[]): DarazAttribute[] {
  return (raw || []).map((a) => ({
    name: a.name,
    label: a.label || a.name,
    mandatory: a.is_mandatory === true || Number(a.is_mandatory) === 1,
    inputType: a.input_type || 'text',
    attributeType: a.attribute_type === 'sku' ? 'sku' : 'normal',
    options: (a.options || []).map((o) => o.name || o.en_name || '').filter(Boolean),
  }));
}

/** A readable one-liner from Daraz's error envelope (top-level message plus per-field detail). */
export function describeDarazError(body: {
  code?: string;
  message?: string;
  detail?: Array<{ field?: string; message?: string }>;
}) {
  const detail = (body.detail || [])
    .map((d) => [d.field, d.message].filter(Boolean).join(': '))
    .filter(Boolean)
    .join('; ');
  return [body.message || `Daraz error ${body.code ?? ''}`.trim(), detail].filter(Boolean).join(' — ');
}
