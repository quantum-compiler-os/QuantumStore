import { requireOwner } from '../_lib/auth.js';
import { listingCollection } from '../_lib/db.js';
import { getAccessToken, getSkuId, updatePriceQuantity } from '../_lib/daraz.js';
import { HttpError, route } from '../_lib/http.js';

/** Sends a new price and/or stock quantity to a QuantumStore product's existing Daraz listing. */
export default route('POST', async (req, res) => {
  await requireOwner(req);
  const { quantumProductId, price, quantity } = (req.body || {}) as {
    quantumProductId?: string;
    price?: number;
    quantity?: number;
  };
  if (!quantumProductId || typeof quantumProductId !== 'string') throw new HttpError(400, 'Missing product id');
  if (price === undefined && quantity === undefined) throw new HttpError(400, 'Send a price or a quantity');
  if (price !== undefined && !(typeof price === 'number' && Number.isFinite(price) && price > 0)) {
    throw new HttpError(400, 'Price must be a number above 0');
  }
  if (quantity !== undefined && !(Number.isInteger(quantity) && quantity >= 0)) {
    throw new HttpError(400, 'Quantity must be a whole number, 0 or more');
  }

  const listing = await (await listingCollection()).findOne({ quantumProductId });
  if (!listing) throw new HttpError(404, 'This product is not listed on Daraz');

  const accessToken = await getAccessToken();
  let skuId = listing.skuId;
  if (!skuId) {
    skuId = await getSkuId(listing.darazItemId, accessToken);
    await (await listingCollection()).updateOne({ _id: listing._id }, { $set: { skuId } });
  }
  await updatePriceQuantity({ itemId: listing.darazItemId, skuId }, { price, quantity }, accessToken);

  res.status(200).json({ ok: true });
});
