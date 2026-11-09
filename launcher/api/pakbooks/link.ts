import { requireOwner } from '../_lib/auth.js';
import { pakbooksCollection } from '../_lib/db.js';
import { route } from '../_lib/http.js';
import { saveSupplierLink } from '../_lib/supplierLink.js';

/** Saves (or updates) the link between a PakBooks book and what was created from it. */
export default route('POST', async (req, res) => {
  await requireOwner(req);
  await saveSupplierLink(await pakbooksCollection(), 'pakbooksId', 'PakBooks', req.body);
  res.status(200).json({ ok: true });
});
