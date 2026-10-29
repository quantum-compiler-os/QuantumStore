import { requireOwner } from '../_lib/auth.js';
import { listingCollection } from '../_lib/db.js';
import {
  DarazError,
  createProduct,
  getAccessToken,
  getCategoryAttributes,
  migrateImage,
} from '../_lib/daraz.js';
import {
  AUTO_ATTRIBUTES,
  NO_BRAND,
  isRejectedValue,
  resolveBrand,
  specsToHtml,
  type DarazProductInput,
} from '../_lib/darazCore.js';
import { HttpError, route } from '../_lib/http.js';

const MAX_IMAGES = 8;

type PublishBody = {
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

export default route('POST', async (req, res) => {
  await requireOwner(req);
  const body = req.body as PublishBody;
  const nums = validate(body);
  const categoryId = Number(body.categoryId);

  const accessToken = await getAccessToken();
  const meta = await getCategoryAttributes(categoryId);

  const attributes = Object.fromEntries(
    Object.entries(body.attributes || {}).filter(([k, v]) => typeof v === 'string' && v.trim() && !AUTO_ATTRIBUTES.has(k)),
  ) as Record<string, string>;
  const missing = meta.filter((a) => a.mandatory && !AUTO_ATTRIBUTES.has(a.name) && !attributes[a.name]);
  if (missing.length) {
    throw new HttpError(400, `Fill in the required Daraz fields: ${missing.map((a) => a.label).join(', ')}`);
  }

  // Daraz hosts its own copies; migrate in parallel. The backend stores full-size images as JPEG, which Daraz accepts.
  const sources = body.images.slice(0, MAX_IMAGES);
  const hosted = await Promise.all(sources.map((url) => migrateImage(url, accessToken)));

  const requestedBrand = (body.brand || '').trim();
  const brand = resolveBrand(requestedBrand, meta.find((a) => a.name === 'brand')?.options);
  const input: DarazProductInput = {
    categoryId,
    name: body.name.trim(),
    description: body.description.trim(),
    shortDescription: specsToHtml(body.specs || []) || undefined,
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

  // A brand Daraz does not know is refused by name; list the product as "No Brand" instead of failing the publish.
  let created;
  let brandReplaced = brand === NO_BRAND && requestedBrand !== '' && requestedBrand !== NO_BRAND;
  try {
    created = await createProduct(input, meta, accessToken);
  } catch (err) {
    if (!(err instanceof DarazError) || brand === NO_BRAND || !isRejectedValue(err.message, brand)) throw err;
    created = await createProduct({ ...input, brand: NO_BRAND }, meta, accessToken);
    brandReplaced = true;
  }

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

  res.status(201).json({ ok: true, ...created, brandReplaced });
});
