import { requireOwner } from '../_lib/auth';
import { exchangeCode } from '../_lib/daraz';
import { extractAuthCode } from '../_lib/darazCore';
import { HttpError, route } from '../_lib/http';

/**
 * Manual finish for the OAuth flow: the owner pastes the code (or the whole redirected address)
 * after approving on Daraz. Used when the app's registered callback URL is not this Launcher.
 * Authorised by the owner's bearer token instead of the signed `state` the automatic callback uses.
 */
export default route('POST', async (req, res) => {
  await requireOwner(req);
  const code = extractAuthCode(req.body?.code);
  if (!code) throw new HttpError(400, 'Paste the code (or the full address) that Daraz redirected you to');
  const conn = await exchangeCode(code);
  res.status(200).json({ ok: true, account: conn.account });
});
