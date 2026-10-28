import { useQuery } from '@tanstack/react-query';
import api from '../api/client';
import {
  getProduct,
  getProductReviews,
  getRelatedProducts,
  listProducts,
  suggestProducts,
  type ProductListParams,
} from '../api/products';
import type { Product, ProductFacets, Review, SuggestItem } from '../api/types';
import { queryKeys } from './queryKeys';

export function useProducts(params?: ProductListParams, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.products.list(params),
    queryFn: () => listProducts(params),
    enabled: options?.enabled ?? true,
  });
}

export function useProduct(id: string | undefined, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.products.detail(id || ''),
    queryFn: () => getProduct(id!),
    enabled: (options?.enabled ?? true) && Boolean(id),
  });
}

export function useRelatedProducts(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.products.related(id || ''),
    queryFn: () => getRelatedProducts(id!),
    enabled: Boolean(id),
  });
}

export function useProductReviews(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.products.reviews(id || ''),
    queryFn: async () => {
      const data = await getProductReviews(id!);
      return data as Review[];
    },
    enabled: Boolean(id),
  });
}

export function useProductFacets(category?: string) {
  return useQuery({
    queryKey: queryKeys.products.facets(category),
    queryFn: async () => {
      const { data } = await api.get<ProductFacets>('/products/facets', {
        params: { category: category && category !== 'All' ? category : undefined },
      });
      return data;
    },
  });
}

export function useProductSuggestions(q: string) {
  const trimmed = q.trim();
  return useQuery({
    queryKey: queryKeys.products.suggest(trimmed),
    queryFn: async () => {
      const data = await suggestProducts(trimmed);
      return data as SuggestItem[];
    },
    enabled: trimmed.length >= 2,
  });
}

export function useProductCategoryNames() {
  return useQuery({
    queryKey: queryKeys.products.categories,
    queryFn: async () => {
      const { data } = await api.get<string[]>('/products/categories');
      return data;
    },
  });
}

export const AUDIONIC_BRAND = 'Audionic';

/** Every Audionic product (the list endpoint caps pages at 48, so walk them all). */
export function useAudionicProducts() {
  return useQuery({
    queryKey: queryKeys.products.audionic,
    queryFn: async () => {
      const items: Product[] = [];
      for (let page = 1; ; page += 1) {
        const data = await listProducts({ brands: AUDIONIC_BRAND, limit: 48, page });
        items.push(...(data.items || []));
        if (page >= (data.pages || 1)) break;
      }
      return items;
    },
  });
}

export function useFeaturedProducts(limit = 4) {
  return useQuery({
    queryKey: queryKeys.products.list({ featured: true, limit }),
    queryFn: async () => {
      const data = await listProducts({ featured: true, limit });
      return (data.items || []).slice(0, limit) as Product[];
    },
  });
}
