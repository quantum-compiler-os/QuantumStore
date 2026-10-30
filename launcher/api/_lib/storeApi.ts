import { DEFAULT_PKR_RATE, pkrRateFrom } from '../../shared/pricing.js';
import { ensureStoreCategory } from '../../shared/ensureCategory.js';
import { quantumApi } from './auth.js';
import { HttpError } from './http.js';
import { failureReason, withRetry } from './net.js';
import type { StoreProduct } from './reconcile.js';

type Fetch = typeof fetch;

const PAGE_SIZE = 48; // the backend never returns more per page
const MAX_PAGES = 200;

/**
 * The QuantumStore backend as the sync uses it, acting with the owner's own bearer token (the one the page or the
 * `npm run sync` script signed in with), so no separate credentials are needed.
 */
export function storeClient(authorization: string, fetchImpl: Fetch = fetch) {
  const base = quantumApi();

  async function request<T>(method: string, path: string, body?: unknown, retries = 0): Promise<T> {
    let response: Response;
    try {
      response = await withRetry(
        () =>
          fetchImpl(`${base}/api${path}`, {
            method,
            headers: { Authorization: authorization, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
            body: body !== undefined ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(30_000),
          }),
        { retries },
      );
    } catch (err) {
      throw new HttpError(502, `Could not reach the QuantumStore backend (${failureReason(err)})`);
    }
    const text = await response.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // not JSON: handled below by status
    }
    if (!response.ok) {
      const message = (data as { message?: string } | null)?.message || `HTTP ${response.status}`;
      // 401/403/429 mean the whole run cannot go on; they keep their status so the caller can stop.
      throw new HttpError([401, 403, 429].includes(response.status) ? response.status : 502, `QuantumStore: ${message}`);
    }
    return data as T;
  }

  return {
    /** Every product in the store, newest first. */
    async products(): Promise<StoreProduct[]> {
      const all: StoreProduct[] = [];
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const data = await request<{ items?: any[]; pages?: number }>('GET', `/products?limit=${PAGE_SIZE}&page=${page}&sort=newest`, undefined, 1);
        for (const p of data.items ?? []) {
          all.push({
            id: String(p._id),
            name: String(p.name ?? ''),
            description: String(p.description ?? ''),
            price: Number(p.price) || 0,
            stock: p.stock === null || p.stock === undefined ? null : Number(p.stock),
            brand: String(p.brand ?? ''),
            category: String(p.category ?? ''),
            image: String(p.image ?? ''),
            images: Array.isArray(p.images) ? p.images.map(String) : [],
          });
        }
        if (page >= (data.pages || 1)) return all;
      }
      throw new HttpError(502, 'QuantumStore returned more pages of products than expected');
    },

    /** PKR per base price unit, from the store settings. */
    async rate() {
      const settings = await request<{ currencies?: unknown }>('GET', '/settings', undefined, 1);
      return pkrRateFrom(settings?.currencies) ?? DEFAULT_PKR_RATE;
    },

    /** The store category with this name, created first when it does not exist (see shared/ensureCategory.ts). */
    async ensureCategory(name: string) {
      const shown = await request<string[]>('GET', '/products/categories', undefined, 1);
      return ensureStoreCategory(name, Array.isArray(shown) ? shown : [], {
        list: () => request<Array<{ name: string }>>('GET', '/categories', undefined, 1),
        create: (categoryName) => request<{ name: string }>('POST', '/categories', { name: categoryName }),
      });
    },

    createProduct: (payload: Record<string, unknown>) => request<{ _id: string }>('POST', '/products', payload),

    async deleteProduct(id: string) {
      await request('DELETE', `/products/${encodeURIComponent(id)}`);
    },
  };
}

export type StoreClient = ReturnType<typeof storeClient>;
