import { describe, expect, it } from 'vitest';
import { isLocalRequest } from '../api/_lib/local';

const local = (over: Record<string, any> = {}) => ({
  headers: { host: '127.0.0.1:5174', ...over.headers },
  socket: { remoteAddress: over.remote ?? '127.0.0.1' },
});

describe('isLocalRequest (gates auto sign-in)', () => {
  it('accepts a loopback browser talking to a loopback host', () => {
    expect(isLocalRequest(local(), {})).toBe(true);
    expect(isLocalRequest(local({ headers: { host: 'localhost:5174' } }), {})).toBe(true);
    expect(isLocalRequest(local({ remote: '::1', headers: { host: '[::1]:5174' } }), {})).toBe(true);
    expect(isLocalRequest(local({ remote: '::ffff:127.0.0.1' }), {})).toBe(true);
  });

  it('refuses remote clients, even with a spoofed localhost Host header', () => {
    expect(isLocalRequest(local({ remote: '203.0.113.9' }), {})).toBe(false);
    expect(isLocalRequest(local({ remote: '192.168.1.20', headers: { host: 'localhost' } }), {})).toBe(false);
  });

  it('refuses non-loopback Host headers (DNS rebinding)', () => {
    expect(isLocalRequest(local({ headers: { host: 'evil.example.com' } }), {})).toBe(false);
    expect(isLocalRequest(local({ headers: { host: 'launcher.vercel.app' } }), {})).toBe(false);
  });

  it('refuses anything that came through a proxy', () => {
    expect(isLocalRequest(local({ headers: { 'x-forwarded-for': '203.0.113.9' } }), {})).toBe(false);
    expect(isLocalRequest(local({ headers: { 'x-real-ip': '203.0.113.9' } }), {})).toBe(false);
  });

  it('is always off on Vercel and in production builds', () => {
    expect(isLocalRequest(local(), { VERCEL: '1' })).toBe(false);
    expect(isLocalRequest(local(), { NODE_ENV: 'production' })).toBe(false);
  });
});
