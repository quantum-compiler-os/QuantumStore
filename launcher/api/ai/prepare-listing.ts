import { requireOwner } from '../_lib/auth.js';
import { route } from '../_lib/http.js';
import { prepareListing, type PrepareBody } from '../_lib/prepareListing.js';

export default route('POST', async (req, res) => {
  await requireOwner(req);
  res.status(200).json({ ok: true, ...(await prepareListing((req.body || {}) as PrepareBody)) });
});
