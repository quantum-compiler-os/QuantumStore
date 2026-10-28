import api from './client';

export async function getSettings() {
  const { data } = await api.get('/settings');
  return data;
}

export async function updateSettings(payload: Record<string, unknown>) {
  const { data } = await api.put('/settings', payload);
  return data;
}
