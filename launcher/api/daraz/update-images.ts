import { requireOwner } from '../_lib/auth.js';
import { listingCollection } from '../_lib/db.js';
import { getAccessToken, getSkuId, migrateImage, setImages } from '../_lib/daraz.js';
import { HttpError, route } from '../_lib/http.js';

const MAX_IMAGES = 8;

/** Sends a QuantumStore product's current images to its existing Daraz listing. */
export default route('POST', async (req, res) => {
  await requireOwner(req);
  const { quantumProductId, images } = (req.body || {}) as { quantumProductId?: string; images?: string[] };
  if (!quantumProductId || typeof quantumProductId !== 'string') throw new HttpError(400, 'Missing product id');
  if (!Array.isArray(images) || !images.length) throw new HttpError(400, 'At least one image is required');
  if (images.some((u) => typeof u !== 'string' || !u.startsWith('https://'))) {
    throw new HttpError(400, 'Images must be public https URLs');
  }

  const listing = await (await listingCollection()).findOne({ quantumProductId });
  if (!listing) throw new HttpError(404, 'This product is not listed on Daraz');

  const accessToken = await getAccessToken();
  let skuId = listing.skuId;
  if (!skuId) {
    skuId = await getSkuId(listing.darazItemId, accessToken);
    await (await listingCollection()).updateOne({ _id: listing._id }, { $set: { skuId } });
  }
  const hosted = await Promise.all(images.slice(0, MAX_IMAGES).map((url) => migrateImage(url, accessToken)));
  await setImages(skuId, hosted, accessToken);

  res.status(200).json({ ok: true, count: hosted.length });
});
