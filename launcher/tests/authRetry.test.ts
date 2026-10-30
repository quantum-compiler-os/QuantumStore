import { AxiosError } from 'axios';
import { describe, expect, it } from 'vitest';
import { RATE_LIMIT_FALLBACK_MS, isRateLimited, rateLimitWaitMs } from '../src/context/authRetry';

const failure = (status: number) =>
  new AxiosError('x', 'ERR_BAD_REQUEST', undefined, undefined, { status, data: {}, statusText: '', headers: {}, config: {} as never });

describe('isRateLimited', () => {
  it('is true only for an HTTP 429', () => {
    expect(isRateLimited(failure(429))).toBe(true);
    expect(isRateLimited(failure(401))).toBe(false);
    expect(isRateLimited(failure(500))).toBe(false);
    expect(isRateLimited(new Error('429'))).toBe(false);
  });
});

describe('rateLimitWaitMs', () => {
  it('waits as long as the backend asks, plus a few seconds', () => {
    expect(rateLimitWaitMs({ 'ratelimit-reset': '240' })).toBe(243_000);
    expect(rateLimitWaitMs({ 'retry-after': 60 })).toBe(63_000);
  });

  it('never waits longer than the 15 minute window', () => {
    expect(rateLimitWaitMs({ 'ratelimit-reset': '99999' })).toBe(15 * 60 * 1000);
  });

  it('falls back to two minutes when nothing usable is sent', () => {
    expect(rateLimitWaitMs(undefined)).toBe(RATE_LIMIT_FALLBACK_MS);
    expect(rateLimitWaitMs({})).toBe(RATE_LIMIT_FALLBACK_MS);
    expect(rateLimitWaitMs({ 'ratelimit-reset': 'soon' })).toBe(RATE_LIMIT_FALLBACK_MS);
    expect(RATE_LIMIT_FALLBACK_MS).toBe(120_000);
  });
});
