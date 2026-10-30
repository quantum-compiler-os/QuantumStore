import { getAutoSession } from './_lib/autoSession.js';
import { HttpError, route } from './_lib/http.js';
import { isLocalRequest } from './_lib/local.js';

/**
 * Local-only auto sign-in: lets the Launcher open without a login screen on the machine that
 * runs it. The owner credentials live in launcher/.env and never leave the server; the browser
 * only receives the same 7-day token a normal login would. Refused everywhere else.
 */
export default route('GET', async (req, res) => {
  if (!isLocalRequest(req)) throw new HttpError(403, 'Auto sign-in is only available on this computer');

  const email = process.env.LAUNCHER_AUTO_LOGIN_EMAIL;
  const password = process.env.LAUNCHER_AUTO_LOGIN_PASSWORD;
  if (!email || !password) throw new HttpError(404, 'Auto sign-in is not configured');

  const api = (process.env.QUANTUM_API_URL || 'http://127.0.0.1:5000').replace(/\/$/, '');
  const { token, user } = await getAutoSession({ api, email, password });
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ ok: true, token, user });
});
