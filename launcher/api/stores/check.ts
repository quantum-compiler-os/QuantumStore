import { requireOwner } from '../_lib/auth.js';
import { queryString, route } from '../_lib/http.js';
import { detectStore } from '../_lib/storeFetcher.js';

/** Whether a shop can be fetched from (a Shopify or WooCommerce shop that prices in rupees), without reading its catalog. */
export default route('GET', async (req, res) => {
  await requireOwner(req);
  const store = await detectStore(queryString(req, 'store'));
  res.status(200).json({ ok: true, store });
});
