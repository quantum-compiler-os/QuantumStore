import axios from 'axios';

/** The Launcher's own serverless functions (not the QuantumStore backend). */
const launcherApi = axios.create({ baseURL: '/launcher-api' });

launcherApi.interceptors.request.use((config) => {
  const token = localStorage.getItem('ql_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export type DarazStatus = {
  configured: boolean;
  redirectUri: string | null;
  connected: boolean;
  account: string | null;
  country: string | null;
  connectedAt: string | null;
  refreshExpiresAt: string | null;
};

export type DarazCategoryLeaf = { id: number; name: string; path: string };

export type DarazAttribute = {
  name: string;
  label: string;
  mandatory: boolean;
  inputType: string;
  attributeType: 'normal' | 'sku';
  options: string[];
};

export type DarazPublishRequest = {
  quantumProductId?: string;
  categoryId: number;
  name: string;
  description: string;
  brand: string;
  sellerSku: string;
  quantity: number;
  price: number;
  specialPrice?: number | null;
  images: string[];
  specs: Array<{ key: string; value: string }>;
  package: { weight: number; length: number; width: number; height: number; content: string };
  attributes: Record<string, string>;
};

export type DarazPublishResult = { itemId: string; skuId: string; sellerSku: string };

export async function getDarazStatus() {
  const { data } = await launcherApi.get<DarazStatus & { ok: true }>('/daraz/status');
  return data;
}

export async function getDarazConnectUrl() {
  const { data } = await launcherApi.get<{ url: string }>('/daraz/connect');
  return data.url;
}

/** Finish connecting by hand: `input` is the code, or the whole address Daraz redirected to. */
export async function exchangeDarazCode(input: string) {
  const { data } = await launcherApi.post<{ account: string }>('/daraz/exchange', { code: input });
  return data;
}

export async function disconnectDaraz() {
  await launcherApi.post('/daraz/disconnect');
}

export async function getDarazCategories() {
  const { data } = await launcherApi.get<{ categories: DarazCategoryLeaf[] }>('/daraz/categories');
  return data.categories;
}

export async function getDarazAttributes(categoryId: number) {
  const { data } = await launcherApi.get<{ attributes: DarazAttribute[] }>('/daraz/attributes', {
    params: { categoryId },
  });
  return data.attributes;
}

export async function getDarazListings(ids: string[]) {
  if (!ids.length) return {};
  const { data } = await launcherApi.get<{ listings: Record<string, { itemId: string; sellerSku: string }> }>(
    '/daraz/listings',
    { params: { ids: ids.join(',') } },
  );
  return data.listings;
}

export async function publishToDaraz(body: DarazPublishRequest) {
  const { data } = await launcherApi.post<DarazPublishResult & { ok: true }>('/daraz/publish', body);
  return data;
}
