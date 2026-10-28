import { verifyState } from '../_lib/auth';
import { darazConfig, exchangeCode } from '../_lib/daraz';
import { queryString, route } from '../_lib/http';

/**
 * Daraz redirects the browser here after consent, so there is no bearer token to check.
 * The signed `state` (issued by ./connect to a verified owner) is what authorises the exchange.
 */
export default route('GET', async (req, res) => {
  const code = queryString(req, 'code');
  const state = queryString(req, 'state');
  const { secret } = darazConfig();

  if (!code || !verifyState(state, secret)) {
    return res.redirect('/settings?daraz=error&reason=invalid-or-expired-link');
  }
  try {
    await exchangeCode(code);
    res.redirect('/settings?daraz=connected');
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'exchange-failed';
    res.redirect(`/settings?daraz=error&reason=${encodeURIComponent(reason)}`);
  }
});
