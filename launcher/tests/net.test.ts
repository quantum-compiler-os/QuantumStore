import { describe, expect, it, vi } from 'vitest';
import { failureReason, withRetry } from '../api/_lib/net';

describe('failureReason', () => {
  it('names the network error code, a timeout, or the message', () => {
    expect(failureReason(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }))).toBe('ENOTFOUND');
    expect(failureReason(Object.assign(new Error('x'), { name: 'TimeoutError' }))).toBe('timed out');
    expect(failureReason(new Error('boom'))).toBe('boom');
    expect(failureReason(undefined)).toBe('unknown error');
  });
});

describe('withRetry', () => {
  it('repeats once after a failure and returns the second answer', async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error('dropped')).mockResolvedValueOnce('ok');
    await expect(withRetry(send, { delayMs: 0 })).resolves.toBe('ok');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('gives up after the retries are used, and can skip retrying', async () => {
    const always = vi.fn().mockRejectedValue(new Error('down'));
    await expect(withRetry(always, { delayMs: 0 })).rejects.toThrow('down');
    expect(always).toHaveBeenCalledTimes(2);

    const once = vi.fn().mockRejectedValue(new Error('down'));
    await expect(withRetry(once, { retries: 0 })).rejects.toThrow('down');
    expect(once).toHaveBeenCalledTimes(1);

    const picky = vi.fn().mockRejectedValue(new Error('no'));
    await expect(withRetry(picky, { delayMs: 0, retryOn: () => false })).rejects.toThrow('no');
    expect(picky).toHaveBeenCalledTimes(1);
  });
});
