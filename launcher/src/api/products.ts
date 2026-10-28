import api from './client';
import type { Product, ProductFacets, ProductListResponse, Review, SuggestItem } from './types';

export type { Product, ProductListResponse } from './types';

export type ProductListParams = {
  category?: string;
  search?: string;
  featured?: string | boolean;
  page?: number;
  limit?: number;
  sort?: string;
  minPrice?: number | string;
  maxPrice?: number | string;
  brands?: string;
  inStock?: string | boolean;
  minRating?: number | string;
};

export async function listProducts(params?: ProductListParams) {
  const { data } = await api.get<ProductListResponse>('/products', { params });
  return data;
}

export async function getProduct(id: string) {
  const { data } = await api.get<Product>(`/products/${id}`);
  return data;
}

export async function getRelatedProducts(id: string) {
  const { data } = await api.get<Product[]>(`/products/${id}/related`);
  return data;
}

export async function getProductReviews(id: string) {
  const { data } = await api.get<Review[]>(`/products/${id}/reviews`);
  return data;
}

export async function createProductReview(id: string, body: { rating: number; comment: string }) {
  const { data } = await api.post(`/products/${id}/reviews`, body);
  return data;
}

export async function suggestProducts(q: string) {
  const { data } = await api.get<SuggestItem[]>('/products/suggest', { params: { q } });
  return data;
}

export async function getFacets() {
  const { data } = await api.get<ProductFacets>('/products/facets');
  return data;
}
