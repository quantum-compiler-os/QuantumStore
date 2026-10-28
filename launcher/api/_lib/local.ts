type RequestLike = {
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
};

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

/**
 * True only for a browser on the same machine talking straight to the dev/preview server.
 * Used to gate auto sign-in, so it fails closed on Vercel, behind any proxy, and for requests
 * whose Host header is not a loopback name (which also blocks DNS-rebinding pages).
 */
export function isLocalRequest(req: RequestLike, env: Record<string, string | undefined> = process.env) {
  if (env.VERCEL || env.NODE_ENV === 'production') return false;
  if (req.headers['x-forwarded-for'] || req.headers['x-forwarded-host'] || req.headers['x-real-ip']) return false;
  if (!LOOPBACK_ADDRESSES.has(req.socket?.remoteAddress || '')) return false;
  const host = String(req.headers.host || '')
    .replace(/:\d+$/, '')
    .replace(/^\[|\]$/g, '');
  return LOOPBACK_HOSTS.has(host);
}
