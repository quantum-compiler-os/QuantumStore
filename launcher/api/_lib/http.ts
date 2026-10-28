import type { IncomingMessage, ServerResponse } from 'node:http';

/** The slice of Vercel's request/response helpers the handlers rely on. */
export type Req = IncomingMessage & {
  query: Record<string, string | string[] | undefined>;
  body?: any;
};
export type Res = ServerResponse & {
  status: (code: number) => Res;
  json: (body: unknown) => void;
  redirect: (location: string) => void;
};

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function queryString(req: Req, key: string) {
  const value = req.query[key];
  return Array.isArray(value) ? value[0] || '' : value || '';
}

/** Wraps a handler: enforces the HTTP method and turns thrown errors into JSON responses. */
export function route(method: 'GET' | 'POST', fn: (req: Req, res: Res) => Promise<void>) {
  return async function handler(req: Req, res: Res) {
    if (req.method !== method) {
      res.setHeader('Allow', method);
      return res.status(405).json({ ok: false, message: `Use ${method}` });
    }
    try {
      await fn(req, res);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      const message = err instanceof Error ? err.message : 'Unexpected error';
      if (status >= 500) console.error('[launcher-api]', err);
      if (!res.headersSent) res.status(status).json({ ok: false, message });
    }
  };
}
