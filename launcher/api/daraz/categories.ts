import { requireOwner } from '../_lib/auth';
import { getCategoryLeaves } from '../_lib/daraz';
import { route } from '../_lib/http';

/** Every leaf category with its breadcrumb path (only leaves accept listings). */
export default route('GET', async (req, res) => {
  await requireOwner(req);
  res.status(200).json({ ok: true, categories: await getCategoryLeaves() });
});
