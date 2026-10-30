import { requireOwner } from '../_lib/auth.js';
import { audionicCollection, type AudionicLink } from '../_lib/db.js';
import { HttpError, route } from '../_lib/http.js';

/** Saves (or updates) the link between an Audionic product and what was created from it. */
export default route('POST', async (req, res) => {
  await requireOwner(req);
  const body = (req.body || {}) as Partial<AudionicLink>;
  if (!body.audionicId || typeof body.audionicId !== 'string') throw new HttpError(400, 'Missing Audionic product id');
  if (!body.quantumProductId || typeof body.quantumProductId !== 'string') throw new HttpError(400, 'Missing product id');
  if (!body.sellerSku || typeof body.sellerSku !== 'string') throw new HttpError(400, 'Missing SKU');
  const sourcePkr = Number(body.sourcePkr);
  if (!Number.isFinite(sourcePkr) || sourcePkr <= 0) throw new HttpError(400, 'Missing price');

  const set: Partial<AudionicLink> = {
    quantumProductId: body.quantumProductId,
    sellerSku: body.sellerSku,
    sourcePkr,
    available: Boolean(body.available),
    syncedAt: new Date(),
  };
  // A later run that only refreshes the store must not forget the Daraz item an earlier run created.
  const darazItemId = typeof body.darazItemId === 'string' && body.darazItemId ? body.darazItemId : null;
  if (darazItemId) set.darazItemId = darazItemId;

  await (await audionicCollection()).updateOne(
    { audionicId: body.audionicId },
    { $set: set, ...(darazItemId ? {} : { $setOnInsert: { darazItemId: null } }) },
    { upsert: true },
  );
  res.status(200).json({ ok: true });
});
