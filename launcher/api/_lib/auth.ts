import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpError, type Req } from './http.js';

function quantumApi() {
  return (process.env.QUANTUM_API_URL || 'http://127.0.0.1:5000').replace(/\/$/, '');
}

/**
 * Lets only the store owner through by replaying their bearer token against the backend's own
 * `protect + adminOnly` route, so the launcher never needs JWT_SECRET or its own user table.
 */
export async function requireOwner(req: Req) {
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Bearer ')) throw new HttpError(401, 'Sign in again');

  let response: Response;
  try {
    response = await fetch(`${quantumApi()}/api/auth/admin-check`, { headers: { Authorization: header } });
  } catch {
    throw new HttpError(502, 'Could not reach the QuantumStore backend to verify your session');
  }
  if (response.status === 401) throw new HttpError(401, 'Your session expired — sign in again');
  if (!response.ok) throw new HttpError(403, 'Only the store owner can use the Launcher');
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
