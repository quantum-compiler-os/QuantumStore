import { requireOwner } from '../_lib/auth.js';
import { fetchCamshamImage } from '../_lib/camsham.js';
import { queryString, route } from '../_lib/http.js';
import { logLine } from '../_lib/log.js';

/**
 * Passes one camsham.pk product picture to the browser, which uploads it through the backend so QuantumStore and Daraz
 * use our own JPEG copy (Daraz does not take CamSham's webp files, and CamSham's server may stop serving other sites).
 */
export default route('GET', async (req, res) => {
  await requireOwner(req);
  const url = queryString(req, 'url');
  const { type, body } = await fetchCamshamImage(url);
  logLine(`camsham picture: ${url.split('/').pop()} (${Math.round(body.length / 1024)} KB)`);
  res.statusCode = 200;
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Length', String(body.length));
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
});
