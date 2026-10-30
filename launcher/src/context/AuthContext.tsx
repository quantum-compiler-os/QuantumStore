import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import axios from 'axios';
import * as authApi from '../api/auth';
import type { User } from '../api/types';
import { restoreSession, singleFlight, type RestoreOutcome } from './restoreSession';

const TOKEN_KEY = 'ql_token';
/** Set on log out so the local auto sign-in does not immediately sign you back in. */
const SKIP_AUTO_KEY = 'ql_skip_auto_login';

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  /** True when sign-in could not start because the QuantumStore backend is not reachable. */
  backendDown: boolean;
  /** When the backend is refusing sign-ins for a while (rate limit), the time (ms since 1970) it will be tried again. */
  rateLimitedUntil: number | null;
  /** Checks the backend again now (it also does this by itself while it is down). */
  recheckBackend: () => void;
  login: (email: string, password: string) => Promise<User>;
  logout: () => void;
  isAdmin: boolean;
  isStaff: boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function normalizeUser(data: User & { id?: string; _id?: string }): User {
  return { ...data, _id: String(data._id || data.id || ''), id: data.id || data._id };
}

function sessionFlag(action: 'get' | 'set' | 'clear') {
  try {
    if (action === 'set') sessionStorage.setItem(SKIP_AUTO_KEY, '1');
    else if (action === 'clear') sessionStorage.removeItem(SKIP_AUTO_KEY);
    else return sessionStorage.getItem(SKIP_AUTO_KEY) === '1';
  } catch {
    /* storage unavailable — auto sign-in just stays on */
  }
  return false;
}

/** One sign-in check at a time, shared by everyone who asks while it runs (see singleFlight). */
const checkSession = singleFlight(() =>
  restoreSession({
    getToken: () => localStorage.getItem(TOKEN_KEY),
    saveToken: (token) => localStorage.setItem(TOKEN_KEY, token),
    removeToken: () => localStorage.removeItem(TOKEN_KEY),
    skipAutoLogin: () => sessionFlag('get'),
    getMe: authApi.getMe,
    getAutoSession: authApi.getAutoSession,
  }),
);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [backendDown, setBackendDown] = useState(false);
  const [rateLimitedUntil, setRateLimitedUntil] = useState<number | null>(null);
  const mounted = useRef(false);

  // Declared first so it is already true when the effects below start their work.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const apply = useCallback((outcome: RestoreOutcome) => {
    if (!mounted.current) return;
    switch (outcome.kind) {
      case 'signed-in':
        setBackendDown(false);
        setRateLimitedUntil(null);
        setUser(normalizeUser(outcome.user));
        break;
      case 'backend-down':
        setBackendDown(true);
        break;
      case 'rate-limited':
        setBackendDown(false);
        setRateLimitedUntil(Date.now() + outcome.waitMs);
        break;
      default:
        setBackendDown(false);
    }
  }, []);

  const restore = useCallback(async () => {
    apply(await checkSession());
  }, [apply]);

  useEffect(() => {
    void restore().finally(() => setLoading(false));
  }, [restore]);

  // While the backend is unreachable, keep checking so the notice clears by itself the moment it answers. The check is
  // the free /api/health call: signing in is only tried once that answers, so a long outage never uses up sign-in attempts.
  useEffect(() => {
    if (!backendDown || user || rateLimitedUntil) return undefined;
    const recheck = async () => {
      try {
        await axios.get('/api/health', { timeout: 8000 });
      } catch {
        return; // still down
      }
      void restore();
    };
    const timer = setInterval(() => void recheck(), 5000);
    const now = () => void recheck();
    window.addEventListener('online', now);
    window.addEventListener('focus', now);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', now);
      window.removeEventListener('focus', now);
    };
  }, [backendDown, user, rateLimitedUntil, restore]);

  // After a rate limit, one more try when the wait is over (never sooner, never in a loop).
  useEffect(() => {
    if (!rateLimitedUntil || user) return undefined;
    const timer = setTimeout(() => {
      setRateLimitedUntil(null);
      void restore();
    }, Math.max(1000, rateLimitedUntil - Date.now()));
    return () => clearTimeout(timer);
  }, [rateLimitedUntil, user, restore]);

  const recheckBackend = useCallback(() => void restore(), [restore]);

  async function login(email: string, password: string) {
    const data = await authApi.login(email, password);
    const next = normalizeUser(data.user);
    localStorage.setItem(TOKEN_KEY, data.token);
    sessionFlag('clear');
    setUser(next);
    return next;
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    sessionFlag('set');
    setUser(null);
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        backendDown,
        rateLimitedUntil,
        recheckBackend,
        login,
        logout,
        isAdmin: user?.role === 'admin',
        isStaff: user?.role === 'staff' || user?.role === 'admin',
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
