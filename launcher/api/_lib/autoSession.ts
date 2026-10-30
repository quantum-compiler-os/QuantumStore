import { HttpError } from './http.js';
import { logLine } from './log.js';
import { failureReason, withRetry } from './net.js';

type Session = { token: string; user: unknown };
type Deps = { fetchImpl?: typeof fetch; now?: () => number };

/**
 * The owner's backend token is remembered for this long. Every page load used to log in again, and the backend only
 * allows 40 sign-in related requests per 15 minutes, so reloading a few times locked the owner out.
 */
export const AUTO_SESSION_CACHE_MS = 30 * 60 * 1000;

let cached: { key: string; session: Session; until: number } | null = null;

export function clearAutoSessionCache() {
  cached = null;
}

/** Signs in to the QuantumStore backend with the owner credentials from launcher/.env (local use only). */
export async function getAutoSession(
  { api, email, password }: { api: string; email: string; password: string },
  { fetchImpl = fetch, now = Date.now }: Deps = {},
): Promise<Session> {
  const key = `${api}|${email}`;
  if (cached && cached.key === key && cached.until > now()) return cached.session;

  let response: Response;
  try {
    // A dropped connection is retried once; signing in twice is harmless.
    response = await withRetry(() =>
      fetchImpl(`${api}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        signal: AbortSignal.timeout(15_000),
      }),
    );
  } catch (err) {
    const reason = failureReason(err);
    logLine(`auto sign-in: could not reach ${api} (${reason})`);
    throw new HttpError(502, `Could not reach the QuantumStore backend (${reason}) — check your connection`);
  }

  if (response.status === 429) {
    logLine('auto sign-in: the backend is rate limiting sign-ins (429)');
    throw new HttpError(429, 'The backend is limiting sign-ins (too many in 15 minutes). Wait a few minutes; the Launcher tries again by itself.');
  }
  if (response.status === 400 || response.status === 401 || response.status === 403) {
    throw new HttpError(401, 'The saved owner credentials were rejected by the backend');
  }
  if (!response.ok) throw new HttpError(502, `The QuantumStore backend could not sign you in (HTTP ${response.status})`);

  const session = (await response.json()) as Session;
  cached = { key, session, until: now() + AUTO_SESSION_CACHE_MS };
  return session;
}
