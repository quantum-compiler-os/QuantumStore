import type { ProductListParams } from '../api/products';

export const queryKeys = {
  products: {
    all: ['products'] as const,
    list: (params?: ProductListParams) => ['products', 'list', params ?? {}] as const,
    detail: (id: string) => ['products', 'detail', id] as const,
    related: (id: string) => ['products', 'related', id] as const,
    reviews: (id: string) => ['products', 'reviews', id] as const,
    facets: (category?: string) => ['products', 'facets', category ?? 'All'] as const,
    suggest: (q: string) => ['products', 'suggest', q] as const,
    categories: ['products', 'categories'] as const,
    audionic: ['products', 'audionic'] as const,
  },
  categories: ['categories'] as const,
  orders: {
    all: ['orders'] as const,
    mine: ['orders', 'mine'] as const,
    admin: (params?: Record<string, unknown>) => ['orders', 'admin', params ?? {}] as const,
    stats: (params?: Record<string, unknown>) => ['orders', 'stats', params ?? {}] as const,
    detail: (id: string) => ['orders', 'detail', id] as const,
  },
  auth: {
    me: ['auth', 'me'] as const,
  },
  settings: ['settings'] as const,
  payments: {
    config: ['payments', 'config'] as const,
  },
};
