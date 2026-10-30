import { listingCollection } from './db.js';
import {
  DarazError,
  createProduct,
  getAccessToken,
  getCategoryAttributes,
  migrateImage,
} from './daraz.js';
import {
  AUTO_ATTRIBUTES,
  NO_BRAND,
  resolveBrand,
  specsToHtml,
  type DarazProductInput,
} from './darazCore.js';
import { HttpError } from './http.js';
import { descriptionProblem } from '../../shared/darazText.js';
import { chatJson, groqConfigured } from './groq.js';
import { attributeRole, readRewriteAnswer, rewriteMessages } from './listingAi.js';
import { logLine } from './log.js';
import { NO_BRAND_NOTE, createWithFallbacks } from './publishFallbacks.js';

const MAX_IMAGES = 8;

export type PublishBody = {
  quantumProductId?: string;
  categoryId: number;
  name: string;
  description: string;
  brand?: string;
  sellerSku: string;
  quantity: number;
  price: number;
  specialPrice?: number | null;
  images: string[];
  specs?: Array<{ key: string; value: string }>;
  package: { weight: number; length: number; width: number; height: number; content?: string };
  attributes?: Record<string, string>;
};

function positive(value: unknown, label: string) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new HttpError(400, `${label} must be greater than 0`);
  return n;
}

function validate(body: PublishBody) {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Missing request body');
  if (!Number.isInteger(Number(body.categoryId)) || Number(body.categoryId) <= 0) {
    throw new HttpError(400, 'Pick a Daraz category');
  }
  if (typeof body.name !== 'string' || body.name.trim().length < 2) throw new HttpError(400, 'Name is required');
  if (typeof body.description !== 'string' || body.description.trim().length < 10) {
    throw new HttpError(400, 'Description must be at least 10 characters');
  }
  const tooShort = descriptionProblem(body.description);
  if (tooShort) throw new HttpError(400, tooShort);
  if (typeof body.sellerSku !== 'string' || !/^[\w.\- ]{1,200}$/.test(body.sellerSku)) {
    throw new HttpError(400, 'SKU may only contain letters, numbers, spaces, dots, dashes and underscores');
  }
  if (!Number.isInteger(Number(body.quantity)) || Number(body.quantity) < 0) {
    throw new HttpError(400, 'Quantity must be a whole number');
  }
  if (!Array.isArray(body.images) || !body.images.length) throw new HttpError(400, 'At least one image is required');
  if (body.images.some((u) => typeof u !== 'string' || !u.startsWith('https://'))) {
    throw new HttpError(400, 'Images must be public https URLs');
  }
  const pkg = body.package || ({} as PublishBody['package']);
  return {
    price: positive(body.price, 'Price'),
    weight: positive(pkg.weight, 'Package weight (kg)'),
    length: positive(pkg.length, 'Package length (cm)'),
    width: positive(pkg.width, 'Package width (cm)'),
    height: positive(pkg.height, 'Package height (cm)'),
  };
}

/** Lists one product on Daraz (the server half of Publish; the sync uses it too). Throws Daraz's own message when it refuses. */
export async function publishListing(body: PublishBody) {
  const nums = validate(body);
  const categoryId = Number(body.categoryId);

  logLine(
    `daraz publish: "${body.name}" SKU ${body.sellerSku} category ${categoryId} price ${nums.price} qty ${body.quantity} images ${body.images.length}`,
  );
  const accessToken = await getAccessToken();
  const meta = await getCategoryAttributes(categoryId);

  const attributes = Object.fromEntries(
    Object.entries(body.attributes || {}).filter(([k, v]) => typeof v === 'string' && v.trim() && !AUTO_ATTRIBUTES.has(k)),
  ) as Record<string, string>;
  const missing = meta.filter((a) => a.mandatory && !AUTO_ATTRIBUTES.has(a.name) && !attributes[a.name]);
  if (missing.length) {
    logLine(`daraz publish: SKU ${body.sellerSku} stopped, required fields missing: ${missing.map((a) => `${a.label} (${a.name})`).join(', ')}`);
    throw new HttpError(400, `Fill in the required Daraz fields: ${missing.map((a) => a.label).join(', ')}`);
  }

  // Daraz hosts its own copies; migrate in parallel. The backend stores full-size images as JPEG, which Daraz accepts.
  const sources = body.images.slice(0, MAX_IMAGES);
  const hosted = await Promise.all(sources.map((url) => migrateImage(url, accessToken)));
  logLine(`daraz publish: SKU ${body.sellerSku} ${hosted.length} image${hosted.length === 1 ? '' : 's'} hosted by Daraz`);

  const requestedBrand = (body.brand || '').trim();
  const brand = resolveBrand(requestedBrand, meta.find((a) => a.name === 'brand')?.options);
  const input: DarazProductInput = {
    categoryId,
    name: body.name.trim(),
    description: body.description.trim(),
    shortDescription: specsToHtml(body.specs || []) || undefined,
    descriptionImage: hosted[0],
    brand,
    sellerSku: body.sellerSku.trim(),
    quantity: Number(body.quantity),
    price: nums.price,
    specialPrice: body.specialPrice ? Number(body.specialPrice) : null,
    images: hosted,
    package: {
      weight: nums.weight,
      length: nums.length,
      width: nums.width,
      height: nums.height,
      content: (body.package.content || body.name).trim(),
    },
    attributes,
  };

  // When Daraz refuses a brand or a keyword it can be worded around once or twice (see createWithFallbacks).
  const initialNotes = brand === NO_BRAND && requestedBrand !== '' && requestedBrand !== NO_BRAND ? [NO_BRAND_NOTE] : [];
  const roles = Object.fromEntries(meta.map((a) => [a.name, attributeRole(a)]));
  const { created, changes } = await createWithFallbacks({
    input,
    attempt: (variant) => createProduct(variant, meta, accessToken),
    isRefusal: (err): err is Error => err instanceof DarazError,
    brandWords: [requestedBrand, 'Audionic'].filter((word, index, all) => word && all.indexOf(word) === index),
    attributeRoles: roles,
    rewrite: groqConfigured()
      ? async (current) =>
          readRewriteAnswer(
            await chatJson(rewriteMessages({ name: current.name, description: current.description, specs: body.specs }, [requestedBrand]), {
              maxTokens: 2048,
              timeoutMs: 30_000,
            }),
            [requestedBrand],
          )
      : undefined,
    log: (text) => logLine(`daraz publish: SKU ${body.sellerSku} ${text}`),
  }).catch((err: unknown) => {
    logLine(`daraz publish: SKU ${body.sellerSku} REFUSED by Daraz: ${err instanceof Error ? err.message : err}`);
    throw err;
  });
  const notes = [...initialNotes, ...changes];
  const brandReplaced = notes.includes(NO_BRAND_NOTE);
  logLine(`daraz publish: SKU ${body.sellerSku} LISTED as item ${created.itemId}${notes.length ? ` (${notes.join('; ')})` : ''}`);

  await (await listingCollection()).updateOne(
    { darazItemId: created.itemId },
    {
      $set: {
        quantumProductId: body.quantumProductId || '',
        darazItemId: created.itemId,
        sellerSku: created.sellerSku,
        skuId: created.skuId,
        categoryId,
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true },
  );

  return { ...created, brandReplaced, changes: notes };
}
