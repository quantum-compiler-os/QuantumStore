import { AxiosError } from 'axios';
import { describe, expect, it, vi } from 'vitest';
import type { User } from '../src/api/types';
import { restoreSession, singleFlight, type RestoreDeps } from '../src/context/restoreSession';

const owner = { _id: '1', email: 'owner@example.com', role: 'admin' } as unknown as User;

const failure = (status: number, headers: Record<string, string> = {}) =>
  new AxiosError('x', 'ERR', undefined, undefined, { status, data: {}, statusText: '', headers, config: {} as never });

function deps(over: Partial<RestoreDeps> = {}) {
  let token: string | null = null;
  const d: RestoreDeps = {
    getToken: () => token,
    saveToken: vi.fn((t: string) => {
      token = t;
    }),
    removeToken: vi.fn(() => {
      token = null;
    }),
    skipAutoLogin: () => false,
    getMe: vi.fn(async () => owner),
    getAutoSession: vi.fn(async () => ({ token: 'auto', user: owner })),
    ...over,
  };
  return { d, setToken: (t: string | null) => (token = t) };
}

describe('restoreSession: with a saved token', () => {
  it('signs in from the token and never touches the auto sign-in', async () => {
    const { d, setToken } = deps();
    setToken('saved');
    expect(await restoreSession(d)).toEqual({ kind: 'signed-in', user: owner });
    expect(d.getAutoSession).not.toHaveBeenCalled();
  });

  it('keeps a refreshed token the backend hands back', async () => {
    const { d, setToken } = deps({ getMe: vi.fn(async () => ({ ...owner, token: 'fresh' })) });
    setToken('old');
    await restoreSession(d);
    expect(d.saveToken).toHaveBeenCalledWith('fresh');
  });

  it('drops a rejected token and falls back to the auto sign-in', async () => {
    const { d, setToken } = deps({ getMe: vi.fn(async () => Promise.reject(failure(401))) });
    setToken('stale');
    expect(await restoreSession(d)).toEqual({ kind: 'signed-in', user: owner });
    expect(d.removeToken).toHaveBeenCalled();
    expect(d.saveToken).toHaveBeenCalledWith('auto');
  });

  it('keeps the token and waits when the backend rate limits, without trying the auto sign-in too', async () => {
    const { d, setToken } = deps({ getMe: vi.fn(async () => Promise.reject(failure(429, { 'ratelimit-reset': '120' }))) });
    setToken('saved');
    expect(await restoreSession(d)).toEqual({ kind: 'rate-limited', waitMs: 123_000 });
    expect(d.removeToken).not.toHaveBeenCalled();
    expect(d.getAutoSession).not.toHaveBeenCalled();
  });

  it('reports the backend as down when nothing else works, keeping the token', async () => {
    const { d, setToken } = deps({
      getMe: vi.fn(async () => Promise.reject(failure(500))),
      getAutoSession: vi.fn(async () => Promise.reject(failure(500))),
    });
    setToken('saved');
    expect(await restoreSession(d)).toEqual({ kind: 'backend-down' });
    expect(d.removeToken).not.toHaveBeenCalled();
  });
});

describe('restoreSession: without a saved token', () => {
  it('uses the local auto sign-in', async () => {
    const { d } = deps();
    expect(await restoreSession(d)).toEqual({ kind: 'signed-in', user: owner });
    expect(d.getMe).not.toHaveBeenCalled();
    expect(d.saveToken).toHaveBeenCalledWith('auto');
  });

  it('does not sign back in after "Sign out"', async () => {
    const { d } = deps({ skipAutoLogin: () => true });
    expect(await restoreSession(d)).toEqual({ kind: 'signed-out' });
    expect(d.getAutoSession).not.toHaveBeenCalled();
  });

  it('tells a rate limit, an unreachable backend and "not available here" apart', async () => {
    const reject = (status: number) => deps({ getAutoSession: vi.fn(async () => Promise.reject(failure(status))) }).d;
    expect(await restoreSession(reject(429))).toEqual({ kind: 'rate-limited', waitMs: 120_000 });
    expect(await restoreSession(reject(502))).toEqual({ kind: 'backend-down' });
    expect(await restoreSession(reject(403))).toEqual({ kind: 'signed-out' });
    expect(await restoreSession(reject(404))).toEqual({ kind: 'signed-out' });
    expect(await restoreSession(reject(401))).toEqual({ kind: 'signed-out' });
  });
});

describe('singleFlight', () => {
  it('gives every caller that arrives while it runs the same result, and runs the work once', async () => {
    let finish: (value: string) => void = () => undefined;
    const work = vi.fn(() => new Promise<string>((resolve) => (finish = resolve)));
    const run = singleFlight(work);
    // React's development mode starts the mount effect twice in a row: both must see the one sign-in.
    const first = run();
    const second = run();
    finish('signed in');
    expect(await first).toBe('signed in');
    expect(await second).toBe('signed in');
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('runs again once the previous run has finished', async () => {
    const work = vi.fn(async () => 'x');
    const run = singleFlight(work);
    await run();
    await run();
    expect(work).toHaveBeenCalledTimes(2);
  });

  it('does not stay stuck after a failure', async () => {
    const work = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce('ok');
    const run = singleFlight(work);
    await expect(run()).rejects.toThrow('boom');
    expect(await run()).toBe('ok');
  });
});
