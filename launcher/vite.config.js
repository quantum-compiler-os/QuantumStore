import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Serves the Vercel-style handlers in api/ under /launcher-api during `npm run dev`
 * (vercel.json rewrites /launcher-api/* to /api/* in production). The handlers get the
 * same `req.query` / `req.body` / `res.status().json()` helpers Vercel adds.
 */
function launcherApi() {
  return {
    name: 'launcher-api',
    configureServer(server) {
      // Vite restarts in the same process when .env changes, so values we loaded earlier must be
      // refreshed; only variables that came from the real environment are left alone.
      const env = loadEnv(server.config.mode, process.cwd(), '');
      const loaded = (globalThis.__launcherEnvKeys ??= new Set());
      for (const [key, value] of Object.entries(env)) {
        if (process.env[key] === undefined || loaded.has(key)) {
          process.env[key] = value;
          loaded.add(key);
        }
      }

      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/launcher-api/')) return next();

        const url = new URL(req.url, 'http://localhost');
        const route = url.pathname.slice('/launcher-api/'.length).replace(/\/+$/, '');
        const segments = route.split('/');
        const file = resolve(process.cwd(), 'api', `${route}.ts`);
        const safe = /^[a-z0-9/_-]+$/i.test(route) && !segments.some((s) => s.startsWith('_'));

        res.status = (code) => {
          res.statusCode = code;
          return res;
        };
        res.json = (body) => {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(body));
        };
        res.redirect = (location) => {
          res.statusCode = 302;
          res.setHeader('Location', location);
          res.end();
        };

        if (!safe || !existsSync(file)) return res.status(404).json({ ok: false, message: 'Not found' });

        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const raw = Buffer.concat(chunks).toString('utf8');
        req.query = Object.fromEntries(url.searchParams);
        req.body = undefined;
        if (raw && String(req.headers['content-type'] || '').includes('application/json')) {
          try {
            req.body = JSON.parse(raw);
          } catch {
            return res.status(400).json({ ok: false, message: 'Invalid JSON body' });
          }
        }

        try {
          const mod = await server.ssrLoadModule(`/api/${route}.ts`);
          await mod.default(req, res);
        } catch (err) {
          server.config.logger.error(String(err?.stack || err));
          if (!res.headersSent) res.status(500).json({ ok: false, message: 'Handler crashed' });
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // The Launcher only runs on this PC and talks to the deployed QuantumStore backend (QUANTUM_API_URL).
  const backend = (loadEnv(mode, process.cwd(), '').QUANTUM_API_URL || 'http://127.0.0.1:5000').replace(/\/$/, '');
  return {
    plugins: [react(), launcherApi()],
    server: {
      host: '127.0.0.1',
      port: 5174,
      proxy: {
        '/api': { target: backend, changeOrigin: true },
        '/uploads': { target: backend, changeOrigin: true },
      },
    },
    test: {
      include: ['tests/**/*.test.ts'],
    },
  };
});
