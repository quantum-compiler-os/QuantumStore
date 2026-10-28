import api from './client';
import type { User } from './types';

export async function login(email: string, password: string) {
  const { data } = await api.post<{ token: string; user: User }>('/auth/login', { email, password });
  return data;
}

export async function getMe() {
  const { data } = await api.get<User & { token?: string }>('/auth/me');
  return data;
}
