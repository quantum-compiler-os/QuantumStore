import { requireOwner } from '../_lib/auth.js';
import { storeLinkCollection } from '../_lib/db.js';
import { HttpError, route } from '../_lib/http.js';
import { saveSupplierLink } from '../_lib/supplierLink.js';

/** Saves (or updates) the link between a fetched shop product and what was created from it. */
export default route('POST', async (req, res) => {
  await requireOwner(req);
  const id = (req.body || {}).storeProductId;
  if (typeof id !== 'string' || !/^[a-z0-9.-]+\/[^/]+$/i.test(id)) throw new HttpError(400, 'Missing shop product id');
  await saveSupplierLink(await storeLinkCollection(), 'storeProductId', 'shop', req.body);
  res.status(200).json({ ok: true });
});
