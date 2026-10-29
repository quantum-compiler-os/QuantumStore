import { requireOwner } from '../_lib/auth.js';
import { listingCollection } from '../_lib/db.js';
import { getAccessToken, getSkuId, removeProduct } from '../_lib/daraz.js';
import { HttpError, route } from '../_lib/http.js';

/** Takes a listing off Daraz and forgets it. Found by QuantumStore product id, or by Daraz item id for leftovers. */
export default route('POST', async (req, res) => {
  await requireOwner(req);
  const { quantumProductId, itemId } = (req.body || {}) as { quantumProductId?: string; itemId?: string };
  const filter = quantumProductId ? { quantumProductId } : itemId ? { darazItemId: String(itemId) } : null;
  if (!filter) throw new HttpError(400, 'Missing product id');

  const listings = await listingCollection();
  const listing = await listings.findOne(filter);
  if (!listing) throw new HttpError(404, 'This product is not listed on Daraz');

  const accessToken = await getAccessToken();
  const skuId = listing.skuId || (await getSkuId(listing.darazItemId, accessToken));
  await removeProduct({ darazItemId: listing.darazItemId, skuId, sellerSku: listing.sellerSku }, accessToken);
  await listings.deleteOne({ _id: listing._id });

  res.status(200).json({ ok: true });
});
