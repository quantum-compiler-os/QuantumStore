import { HttpError } from './http';
import { connectionCollection, type DarazConnection } from './db';
import {
  buildImageMigrateXml,
  buildProductXml,
  describeDarazError,
  flattenCategoryTree,
  normalizeAttributes,
  signRequest,
  type DarazAttribute,
  type DarazCategoryLeaf,
  type DarazProductInput,
} from './darazCore';

/** A failed Daraz call; surfaces to the client as a 422 carrying Daraz's own message. */
export class DarazError extends HttpError {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(422, message);
  }
}

export function darazConfig() {
  const appKey = process.env.DARAZ_APP_KEY;
  const secret = process.env.DARAZ_APP_SECRET;
  if (!appKey || !secret) throw new HttpError(500, 'DARAZ_APP_KEY / DARAZ_APP_SECRET are not set for the launcher');
  return {
    appKey,
    secret,
    host: (process.env.DARAZ_API_HOST || 'https://api.daraz.pk').replace(/\/$/, ''),
    redirectUri: process.env.DARAZ_REDIRECT_URI || '',
  };
}

type CallOptions = {
  method?: 'GET' | 'POST';
  params?: Record<string, string>;
  accessToken?: string;
};

/** One signed Daraz call. System params + signature go in the query string, business params in the form body. */
async function call<T = any>(apiPath: string, { method = 'GET', params = {}, accessToken }: CallOptions = {}) {
  const { appKey, secret, host } = darazConfig();
  const system: Record<string, string> = {
    app_key: appKey,
    timestamp: String(Date.now()),
    sign_method: 'sha256',
    ...(accessToken ? { access_token: accessToken } : {}),
  };
  const sign = signRequest(apiPath, { ...params, ...system }, secret);
  const query = new URLSearchParams({ ...system, sign });
  if (method === 'GET') for (const [k, v] of Object.entries(params)) query.set(k, v);

  const url = `${host}/rest${apiPath}?${query}`;
  let response: Response;
  try {
    response =
      method === 'GET'
        ? await fetch(url)
        : await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(params),
          });
  } catch {
    throw new DarazError('Could not reach Daraz — check your connection and try again');
  }

  const text = await response.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    throw new DarazError(`Daraz returned an unreadable response (HTTP ${response.status})`);
  }
  if (body.code !== undefined && String(body.code) !== '0') {
    throw new DarazError(describeDarazError(body), String(body.code));
  }
  return body as T;
}

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_expires_in?: number;
  account?: string;
  country?: string;
  country_user_info?: Array<{ seller_id?: string }>;
};

async function saveTokens(token: TokenResponse, previous?: DarazConnection | null) {
  const now = Date.now();
  const doc: DarazConnection = {
    _id: 'connection',
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: new Date(now + token.expires_in * 1000),
    refreshExpiresAt: token.refresh_expires_in ? new Date(now + token.refresh_expires_in * 1000) : null,
    account: token.account || previous?.account || '',
    country: token.country || previous?.country || '',
    sellerId: token.country_user_info?.[0]?.seller_id || previous?.sellerId || '',
    connectedAt: previous?.connectedAt || new Date(now),
  };
  await (await connectionCollection()).replaceOne({ _id: 'connection' }, doc, { upsert: true });
  return doc;
}

export function authorizeUrl(state: string) {
  const { appKey, host, redirectUri } = darazConfig();
  if (!redirectUri) throw new HttpError(500, 'DARAZ_REDIRECT_URI is not set for the launcher');
  const query = new URLSearchParams({
    response_type: 'code',
    force_auth: 'true',
    redirect_uri: redirectUri,
    client_id: appKey,
    state,
  });
  return `${host}/oauth/authorize?${query}`;
}

export async function exchangeCode(code: string) {
  const token = await call<TokenResponse>('/auth/token/create', { params: { code } });
  return saveTokens(token);
}

export async function getConnection() {
  return (await connectionCollection()).findOne({ _id: 'connection' });
}

export async function disconnect() {
  await (await connectionCollection()).deleteOne({ _id: 'connection' });
}

/** Current access token, refreshed when it is within 5 minutes of expiring. */
export async function getAccessToken() {
  const conn = await getConnection();
  if (!conn) throw new HttpError(409, 'Daraz is not connected — connect it from Settings first');
  if (conn.expiresAt.getTime() - Date.now() > 5 * 60 * 1000) return conn.accessToken;

  try {
    const token = await call<TokenResponse>('/auth/token/refresh', { params: { refresh_token: conn.refreshToken } });
    return (await saveTokens(token, conn)).accessToken;
  } catch (err) {
    if (err instanceof DarazError && err.code) {
      throw new HttpError(409, 'The Daraz connection expired — reconnect it from Settings');
    }
    throw err;
  }
}

const TTL = 6 * 60 * 60 * 1000;
let leavesCache: { at: number; data: DarazCategoryLeaf[] } | null = null;
const attributeCache = new Map<number, { at: number; data: DarazAttribute[] }>();

export async function getCategoryLeaves() {
  if (leavesCache && Date.now() - leavesCache.at < TTL) return leavesCache.data;
  const accessToken = await getAccessToken();
  const body = await call<{ data: any[] }>('/category/tree/get', { accessToken });
  leavesCache = { at: Date.now(), data: flattenCategoryTree(body.data) };
  return leavesCache.data;
}

export async function getCategoryAttributes(categoryId: number) {
  const hit = attributeCache.get(categoryId);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  const accessToken = await getAccessToken();
  const body = await call<{ data: any[] }>('/category/attributes/get', {
    accessToken,
    params: { primary_category_id: String(categoryId) },
  });
  const data = normalizeAttributes(body.data);
  attributeCache.set(categoryId, { at: Date.now(), data });
  return data;
}

/** Daraz only accepts images hosted on its own servers, so each URL is re-hosted first. */
export async function migrateImage(url: string, accessToken: string) {
  const body = await call<{ data?: { image?: { url?: string } } }>('/image/migrate', {
    method: 'POST',
    accessToken,
    params: { payload: buildImageMigrateXml(url) },
  });
  const hosted = body.data?.image?.url;
  if (!hosted) throw new DarazError('Daraz did not return a hosted image URL');
  return hosted;
}

export type DarazCreateResult = { itemId: string; skuId: string; sellerSku: string };

export async function createProduct(input: DarazProductInput, meta: DarazAttribute[], accessToken: string) {
  const body = await call<{ data?: { item_id?: number | string; sku_list?: Array<{ sku_id?: number | string }> } }>(
    '/product/create',
    { method: 'POST', accessToken, params: { payload: buildProductXml(input, meta) } },
  );
  const itemId = body.data?.item_id;
  if (itemId === undefined) throw new DarazError('Daraz accepted the request but returned no item id');
  return {
    itemId: String(itemId),
    skuId: String(body.data?.sku_list?.[0]?.sku_id ?? ''),
    sellerSku: input.sellerSku,
  } satisfies DarazCreateResult;
}
