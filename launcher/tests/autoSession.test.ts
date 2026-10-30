import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTO_SESSION_CACHE_MS, clearAutoSessionCache, getAutoSession } from '../api/_lib/autoSession';

const creds = { api: 'https://backend.example', email: 'owner@example.com', password: 'pw' };
const ok = () => new Response(JSON.stringify({ token: 't1', user: { email: 'owner@example.com' } }), { status: 200 });
const status = (code: number) => vi.fn(async () => new Response('{}', { status: code })) as unknown as typeof fetch;

beforeEach(() => clearAutoSessionCache());

describe('getAutoSession', () => {
  it('logs in once and reuses the token until the cache runs out', async () => {
    const fetchImpl = vi.fn(async () => ok()) as unknown as typeof fetch;
    let time = 1_000;
    const deps = { fetchImpl, now: () => time };
    expect(await getAutoSession(creds, deps)).toEqual({ token: 't1', user: { email: 'owner@example.com' } });
    await getAutoSession(creds, deps);
    time += AUTO_SESSION_CACHE_MS - 1;
    await getAutoSession(creds, deps);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    time += 2;
    await getAutoSession(creds, deps);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('sends the credentials to the backend login', async () => {
    const fetchImpl = vi.fn(async () => ok());
    await getAutoSession(creds, { fetchImpl: fetchImpl as unknown as typeof fetch });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://backend.example/api/auth/login');
    expect(JSON.parse(String(init.body))).toEqual({ email: 'owner@example.com', password: 'pw' });
  });

  it('does not reuse a token for a different account or backend', async () => {
    const fetchImpl = vi.fn(async () => ok()) as unknown as typeof fetch;
    await getAutoSession(creds, { fetchImpl });
    await getAutoSession({ ...creds, email: 'other@example.com' }, { fetchImpl });
    await getAutoSession({ ...creds, api: 'https://other.example' }, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('reports a rate limit as a rate limit, not as rejected credentials', async () => {
    await expect(getAutoSession(creds, { fetchImpl: status(429) })).rejects.toMatchObject({
      status: 429,
      message: expect.stringMatching(/limiting sign-ins/),
    });
  });

  it('keeps the other failures apart and never caches them', async () => {
    await expect(getAutoSession(creds, { fetchImpl: status(401) })).rejects.toMatchObject({ status: 401 });
    await expect(getAutoSession(creds, { fetchImpl: status(503) })).rejects.toMatchObject({
      status: 502,
      message: expect.stringMatching(/HTTP 503/),
    });
    const down = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    await expect(getAutoSession(creds, { fetchImpl: down })).rejects.toMatchObject({ status: 502 });

    const fetchImpl = vi.fn(async () => ok()) as unknown as typeof fetch;
    await getAutoSession(creds, { fetchImpl }); // a failure earlier did not poison the cache
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
