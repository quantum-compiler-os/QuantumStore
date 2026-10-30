import { requireOwner } from '../_lib/auth.js';
import { queryString, route } from '../_lib/http.js';
import { readLog } from '../_lib/syncState.js';

/** The lines the running (or last) sync has logged after the first `since`. */
export default route('GET', async (req, res) => {
  await requireOwner(req);
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ ok: true, ...readLog(Number(queryString(req, 'since')) || 0) });
});
