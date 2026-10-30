import axios from 'axios';

/** Waited after a rate limit when the backend does not say how long (its window is 15 minutes). */
export const RATE_LIMIT_FALLBACK_MS = 2 * 60 * 1000;
const MAX_RATE_LIMIT_WAIT_MS = 15 * 60 * 1000;

export function isRateLimited(err: unknown) {
  return axios.isAxiosError(err) && err.response?.status === 429;
}

/** How long to wait before signing in again: what the backend asked for (`RateLimit-Reset` / `Retry-After`, in seconds), else the fallback. */
export function rateLimitWaitMs(headers: Record<string, unknown> | undefined, fallback = RATE_LIMIT_FALLBACK_MS) {
  const seconds = Number(headers?.['ratelimit-reset'] ?? headers?.['retry-after']);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000 + 3000, MAX_RATE_LIMIT_WAIT_MS) : fallback;
}
