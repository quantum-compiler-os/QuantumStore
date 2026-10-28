import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import * as authApi from '../api/auth';
import type { User } from '../api/types';

const TOKEN_KEY = 'ql_token';

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => void;
  isAdmin: boolean;
  isStaff: boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function normalizeUser(data: User & { id?: string; _id?: string }): User {
  return { ...data, _id: String(data._id || data.id || ''), id: data.id || data._id };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!localStorage.getItem(TOKEN_KEY)) {
      setLoading(false);
      return;
    }
    authApi
      .getMe()
      .then((data) => {
        if (data.token) localStorage.setItem(TOKEN_KEY, data.token);
        setUser(normalizeUser(data));
      })
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string) {
    const data = await authApi.login(email, password);
    const next = normalizeUser(data.user);
    localStorage.setItem(TOKEN_KEY, data.token);
    setUser(next);
    return next;
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
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
