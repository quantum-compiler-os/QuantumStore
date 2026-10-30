import { requireOwner } from '../_lib/auth.js';
import { publishListing, type PublishBody } from '../_lib/darazPublish.js';
import { route } from '../_lib/http.js';

export default route('POST', async (req, res) => {
  await requireOwner(req);
  const result = await publishListing(req.body as PublishBody);
  res.status(201).json({ ok: true, ...result });
});
