import { requireOwner } from '../_lib/auth.js';
import { disconnect } from '../_lib/daraz.js';
import { route } from '../_lib/http.js';

export default route('POST', async (req, res) => {
  await requireOwner(req);
  await disconnect();
  res.status(200).json({ ok: true });
});
