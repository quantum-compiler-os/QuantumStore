import { requireOwner } from '../_lib/auth.js';
import { queryString, route } from '../_lib/http.js';
import { logLine } from '../_lib/log.js';
import { fetchPakbooksImage } from '../_lib/pakbooks.js';

/**
 * Passes one PakBooks picture to the browser, which turns it into a JPEG (enlarged when too small) and uploads it through
 * the backend: Daraz refuses PakBooks' GIF covers and pictures under 330×330 px.
 */
export default route('GET', async (req, res) => {
  await requireOwner(req);
  const url = queryString(req, 'url');
  const { type, body } = await fetchPakbooksImage(url);
  logLine(`pakbooks picture: ${url.split('/').pop()?.split('?')[0]} (${Math.round(body.length / 1024)} KB, ${type})`);
  res.statusCode = 200;
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Length', String(body.length));
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
});
