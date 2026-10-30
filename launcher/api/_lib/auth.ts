import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { HttpError, type Req } from './http.js';

export function quantumApi() {
  return (process.env.QUANTUM_API_URL || 'http://127.0.0.1:5000').replace(/\/$/, '');
}

/**
 * The backend allows only 40 requests per 15 minutes under /api/auth, and every Launcher call checks the owner there.
 * A sync makes hundreds of calls, so a verified token is remembered for a few minutes instead of being checked each time.
 * Only a successful check is remembered, and the token itself is never stored, only its hash.
 */
export const OWNER_CACHE_MS = 5 * 60 * 1000;
const MAX_CACHED_TOKENS = 20;
const verifiedUntil = new Map<string, number>();

export function clearOwnerCache() {
  verifiedUntil.clear();
}

type OwnerDeps = { fetchImpl?: typeof fetch; now?: () => number };

/**
 * Lets only the store owner through by replaying their bearer token against the backend's own
 * `protect + adminOnly` route, so the launcher never needs JWT_SECRET or its own user table.
 */
export async function requireOwner(req: Req, { fetchImpl = fetch, now = Date.now }: OwnerDeps = {}) {
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Bearer ')) throw new HttpError(401, 'Sign in again');

  const key = createHash('sha256').update(header).digest('hex');
  const current = now();
  if ((verifiedUntil.get(key) ?? 0) > current) return;

  let response: Response;
  try {
    response = await fetchImpl(`${quantumApi()}/api/auth/admin-check`, { headers: { Authorization: header } });
  } catch {
    throw new HttpError(502, 'Could not reach the QuantumStore backend to verify your session');
  }
  if (response.status === 401) throw new HttpError(401, 'Your session expired — sign in again');
  if (response.status === 403) throw new HttpError(403, 'Only the store owner can use the Launcher');
  if (response.status === 429) {
    throw new HttpError(
      429,
      'The backend is limiting sign-in checks (too many in 15 minutes). Wait a few minutes and try again; the Launcher now checks once every 5 minutes instead of on every request.',
    );
  }
  // Anything else (500, 503…) is a backend problem, not a verdict on who you are.
  if (!response.ok) throw new HttpError(502, `The QuantumStore backend could not verify your session (HTTP ${response.status})`);

  if (verifiedUntil.size >= MAX_CACHED_TOKENS) verifiedUntil.clear();
  verifiedUntil.set(key, current + OWNER_CACHE_MS);
}

/** OAuth `state`: proves the callback belongs to a flow an owner started in the last 10 minutes. */
export function signState(secret: string, now = Date.now()) {
  const stamp = String(now);
  const mac = createHmac('sha256', secret).update(`daraz-oauth:${stamp}`).digest('hex');
  return `${stamp}.${mac}`;
}

export function verifyState(state: string, secret: string, now = Date.now()) {
  const [stamp, mac] = state.split('.');
  if (!stamp || !mac || !/^\d+$/.test(stamp)) return false;
  if (now - Number(stamp) > 10 * 60 * 1000 || now < Number(stamp)) return false;
  const expected = createHmac('sha256', secret).update(`daraz-oauth:${stamp}`).digest('hex');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
