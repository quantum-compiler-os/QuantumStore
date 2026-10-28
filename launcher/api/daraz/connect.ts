import { requireOwner, signState } from '../_lib/auth';
import { authorizeUrl, darazConfig } from '../_lib/daraz';
import { route } from '../_lib/http';

/** Returns the Daraz consent URL; the browser navigates there and Daraz redirects to ./callback. */
export default route('GET', async (req, res) => {
  await requireOwner(req);
  const { secret } = darazConfig();
  res.status(200).json({ ok: true, url: authorizeUrl(signState(secret)) });
});
