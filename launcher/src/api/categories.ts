import api from './client';

export async function listCategories() {
  const { data } = await api.get('/categories');
  return data;
}

export async function createCategory(name: string) {
  const { data } = await api.post('/categories', { name });
  return data;
}

export async function deleteCategory(id: string) {
  const { data } = await api.delete(`/categories/${id}`);
  return data;
}
