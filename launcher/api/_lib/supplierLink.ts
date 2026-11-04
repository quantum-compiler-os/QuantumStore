import type { Collection, Document, Filter, UpdateFilter } from 'mongodb';
import { HttpError } from './http.js';

/**
 * Saves (or updates) the link between a supplier product (Audionic, CamSham…) and what was created from it.
 * `idKey` is the field holding the supplier's product id in that supplier's collection.
 */
export async function saveSupplierLink<T extends Document>(collection: Collection<T>, idKey: string, label: string, raw: unknown) {
  const body = (raw || {}) as Record<string, unknown>;
  const id = body[idKey];
  if (!id || typeof id !== 'string') throw new HttpError(400, `Missing ${label} product id`);
  if (!body.quantumProductId || typeof body.quantumProductId !== 'string') throw new HttpError(400, 'Missing product id');
  if (!body.sellerSku || typeof body.sellerSku !== 'string') throw new HttpError(400, 'Missing SKU');
  const sourcePkr = Number(body.sourcePkr);
  if (!Number.isFinite(sourcePkr) || sourcePkr <= 0) throw new HttpError(400, 'Missing price');

  const set: Document = {
    quantumProductId: body.quantumProductId,
    sellerSku: body.sellerSku,
    sourcePkr,
    available: Boolean(body.available),
    syncedAt: new Date(),
  };
  // A later run that only refreshes the store must not forget the Daraz item an earlier run created.
  const darazItemId = typeof body.darazItemId === 'string' && body.darazItemId ? body.darazItemId : null;
  if (darazItemId) set.darazItemId = darazItemId;

  await collection.updateOne(
    { [idKey]: id } as Filter<T>,
    { $set: set, ...(darazItemId ? {} : { $setOnInsert: { darazItemId: null } }) } as UpdateFilter<T>,
    { upsert: true },
  );
}
