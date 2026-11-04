import { requireOwner } from '../_lib/auth.js';
import { route } from '../_lib/http.js';
import { logLine } from '../_lib/log.js';
import { prepareListing, type PrepareBody } from '../_lib/prepareListing.js';

export default route('POST', async (req, res) => {
  await requireOwner(req);
  const body = (req.body || {}) as PrepareBody;
  const name = String(body.name || 'product').slice(0, 80);
  logLine(`ai prepare-listing: asking Groq for "${name}"`);
  const prepared = await prepareListing(body);
  logLine(`ai prepare-listing: "${name}" ready`);
  res.status(200).json({ ok: true, ...prepared });
});
