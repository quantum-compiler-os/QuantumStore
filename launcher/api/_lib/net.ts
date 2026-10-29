/** Why a `fetch` failed, in a few words: the network error code (ENOTFOUND, ETIMEDOUT…) or "timed out". */
export function failureReason(err: unknown) {
  const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return 'timed out';
  return e?.cause?.code || e?.cause?.message || e?.message || 'unknown error';
}

/**
 * Runs `send` again after a short pause when it throws (a dropped connection, a DNS hiccup). `send` builds the
 * request each time, so a fresh timeout is used. Only for calls that are safe to repeat.
 */
export async function withRetry<T>(
  send: () => Promise<T>,
  { retries = 1, delayMs = 600, retryOn = () => true }: { retries?: number; delayMs?: number; retryOn?: (err: unknown) => boolean } = {},
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await send();
    } catch (err) {
      if (attempt >= retries || !retryOn(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
