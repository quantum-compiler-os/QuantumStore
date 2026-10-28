import { requireOwner } from '../_lib/auth';
import { disconnect } from '../_lib/daraz';
import { route } from '../_lib/http';

export default route('POST', async (req, res) => {
  await requireOwner(req);
  await disconnect();
  res.status(200).json({ ok: true });
});
