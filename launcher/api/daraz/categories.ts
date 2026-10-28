import { requireOwner } from '../_lib/auth.js';
import { getCategoryLeaves } from '../_lib/daraz.js';
import { route } from '../_lib/http.js';

/** Every leaf category with its breadcrumb path (only leaves accept listings). */
export default route('GET', async (req, res) => {
  await requireOwner(req);
  res.status(200).json({ ok: true, categories: await getCategoryLeaves() });
});
