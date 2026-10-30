import axios from 'axios';
import type { User } from '../api/types';
import { RATE_LIMIT_FALLBACK_MS, isRateLimited, rateLimitWaitMs } from './authRetry';

export type RestoreOutcome =
  | { kind: 'signed-in'; user: User }
  | { kind: 'backend-down' }
  | { kind: 'rate-limited'; waitMs: number }
  | { kind: 'signed-out' };

export type RestoreDeps = {
  getToken: () => string | null;
  saveToken: (token: string) => void;
  removeToken: () => void;
  /** True after "Sign out", so the local auto sign-in does not immediately sign back in. */
  skipAutoLogin: () => boolean;
  getMe: () => Promise<User & { token?: string }>;
  getAutoSession: () => Promise<{ token: string; user: User }>;
};

const statusOf = (err: unknown) => (axios.isAxiosError(err) ? err.response?.status : undefined);

/**
 * Works out who is signed in: from the saved token, else from the local auto sign-in. It only reports what happened;
 * the caller decides what to show. A rate limit is neither "down" nor "rejected": the saved token is kept and the
 * caller waits before asking again, because refused requests are counted against the limit too.
 */
export async function restoreSession(deps: RestoreDeps): Promise<RestoreOutcome> {
  let downFromToken = false;

  if (deps.getToken()) {
    try {
      const data = await deps.getMe();
      if (data.token) deps.saveToken(data.token);
      return { kind: 'signed-in', user: data };
    } catch (err) {
      if (isRateLimited(err)) {
        const headers = axios.isAxiosError(err) ? (err.response?.headers as Record<string, unknown>) : undefined;
        return { kind: 'rate-limited', waitMs: rateLimitWaitMs(headers) };
      }
      // Only a rejected token is dropped; a backend that is merely down keeps the saved session
      // (the dev proxy answers 500 when it can't connect, so any non-auth failure counts as down).
      const status = statusOf(err);
      if (status === 401 || status === 403) deps.removeToken();
      else downFromToken = true;
    }
  }

  if (deps.skipAutoLogin()) return { kind: downFromToken ? 'backend-down' : 'signed-out' };

  try {
    // Only answers on the machine running the Launcher; anywhere else this 403s and the login page shows.
    const session = await deps.getAutoSession();
    deps.saveToken(session.token);
    return { kind: 'signed-in', user: session.user };
  } catch (err) {
    const status = statusOf(err);
    if (status === 429) return { kind: 'rate-limited', waitMs: RATE_LIMIT_FALLBACK_MS };
    // 502 = the Launcher server could not reach the backend; 403/404 just mean "not local / not configured".
    if (status === 502) return { kind: 'backend-down' };
    if (status === 403 || status === 404) return { kind: 'signed-out' };
    return { kind: downFromToken ? 'backend-down' : 'signed-out' };
  }
}

/**
 * Runs `fn` once at a time: callers that arrive while it is running get the same promise (and so the same result)
 * instead of starting a second run or being turned away. React's development mode starts every effect twice, and the
 * second start must still see the first one's sign-in.
 */
export function singleFlight<T>(fn: () => Promise<T>) {
  let running: Promise<T> | null = null;
  return () => {
    running ??= fn().finally(() => {
      running = null;
    });
    return running;
  };
}
