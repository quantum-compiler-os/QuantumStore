import { requireOwner } from '../_lib/auth.js';
import { camshamCollection } from '../_lib/db.js';
import { route } from '../_lib/http.js';
import { saveSupplierLink } from '../_lib/supplierLink.js';

/** Saves (or updates) the link between a CamSham product and what was created from it. */
export default route('POST', async (req, res) => {
  await requireOwner(req);
  await saveSupplierLink(await camshamCollection(), 'camshamId', 'CamSham', req.body);
  res.status(200).json({ ok: true });
});
