import { requireOwner } from '../_lib/auth.js';
import { queryString, route } from '../_lib/http.js';
import { logLine } from '../_lib/log.js';
import { fetchStoreImage } from '../_lib/storeFetcher.js';

/**
 * Passes one of a fetched shop's pictures to the browser, which turns it into a JPEG Daraz accepts (enlarged when too
 * small) and uploads it through the backend, so neither shop depends on the other shop's server.
 */
export default route('GET', async (req, res) => {
  await requireOwner(req);
  const url = queryString(req, 'url');
  const { type, body } = await fetchStoreImage(url);
  logLine(`store fetcher picture: ${url.split('/').pop()?.split('?')[0]} (${Math.round(body.length / 1024)} KB, ${type})`);
  res.statusCode = 200;
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Length', String(body.length));
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
});
