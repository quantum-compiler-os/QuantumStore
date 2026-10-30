import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OWNER_CACHE_MS, clearOwnerCache, requireOwner } from '../api/_lib/auth';
import type { Req } from '../api/_lib/http';

const req = (token = 'abc') => ({ headers: token ? { authorization: `Bearer ${token}` } : {} }) as unknown as Req;
const answer = (status: number) => vi.fn(async () => new Response('{}', { status })) as unknown as typeof fetch;

beforeEach(() => clearOwnerCache());

describe('requireOwner', () => {
  it('asks the backend once and remembers the answer for a few minutes', async () => {
    const fetchImpl = answer(200);
    let time = 1_000;
    const deps = { fetchImpl, now: () => time };
    await requireOwner(req(), deps);
    await requireOwner(req(), deps);
    time += OWNER_CACHE_MS - 1;
    await requireOwner(req(), deps);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    time += 2; // the remembered answer has expired
    await requireOwner(req(), deps);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('checks each token separately', async () => {
    const fetchImpl = answer(200);
    await requireOwner(req('one'), { fetchImpl });
    await requireOwner(req('two'), { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('never remembers a refusal', async () => {
    const denied = answer(403);
    await expect(requireOwner(req(), { fetchImpl: denied })).rejects.toMatchObject({ status: 403 });
    await expect(requireOwner(req(), { fetchImpl: denied })).rejects.toMatchObject({ status: 403 });
    expect(denied).toHaveBeenCalledTimes(2);
  });

  it('tells a rate limit apart from "not the owner"', async () => {
    await expect(requireOwner(req(), { fetchImpl: answer(429) })).rejects.toMatchObject({
      status: 429,
      message: expect.stringMatching(/limiting sign-in checks.*every 5 minutes/),
    });
  });

  it('reports an expired session, a backend fault and an unreachable backend as what they are', async () => {
    await expect(requireOwner(req(), { fetchImpl: answer(401) })).rejects.toMatchObject({ status: 401 });
    await expect(requireOwner(req(), { fetchImpl: answer(503) })).rejects.toMatchObject({
      status: 502,
      message: expect.stringMatching(/HTTP 503/),
    });
    const down = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    await expect(requireOwner(req(), { fetchImpl: down })).rejects.toMatchObject({ status: 502 });
  });

  it('needs a bearer token', async () => {
    const fetchImpl = answer(200);
    await expect(requireOwner(req(''), { fetchImpl })).rejects.toMatchObject({ status: 401 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
