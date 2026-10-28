import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import axios from 'axios';
import * as authApi from '../api/auth';
import type { User } from '../api/types';

const TOKEN_KEY = 'ql_token';
/** Set on log out so the local auto sign-in does not immediately sign you back in. */
const SKIP_AUTO_KEY = 'ql_skip_auto_login';

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  /** True when sign-in could not start because the QuantumStore backend is not reachable. */
  backendDown: boolean;
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [backendDown, setBackendDown] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function restore() {
      if (localStorage.getItem(TOKEN_KEY)) {
        try {
          const data = await authApi.getMe();
          if (data.token) localStorage.setItem(TOKEN_KEY, data.token);
          if (!cancelled) setUser(normalizeUser(data));
          return;
        } catch (err) {
          // Only a rejected token is dropped; a backend that is merely down keeps the saved session
          // (the dev proxy answers 500 when it can't connect, so any non-auth failure counts as down).
          const status = axios.isAxiosError(err) ? err.response?.status : undefined;
          if (status === 401 || status === 403) localStorage.removeItem(TOKEN_KEY);
          else if (!cancelled) setBackendDown(true);
        }
      }
      if (sessionFlag('get')) return;
      try {
        // Only answers on the machine running the Launcher; anywhere else this 403s and the login page shows.
        const session = await authApi.getAutoSession();
        localStorage.setItem(TOKEN_KEY, session.token);
        if (!cancelled) {
          setBackendDown(false);
          setUser(normalizeUser(session.user));
        }
      } catch (err) {
        // 502 = the Launcher server could not reach the backend; 403/404 just mean "not local / not configured".
        if (axios.isAxiosError(err) && err.response?.status === 502 && !cancelled) setBackendDown(true);
      }
    }

    restore().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
