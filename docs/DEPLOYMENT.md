# Deployment guide — QuantumStore on Vercel

Production deployment for **three Vercel projects** (storefront SPA, Launcher staff site, Express API as serverless), with MongoDB Atlas, Google Drive image storage, Stripe, and Resend.

## Architecture

| Project | Root directory | Role |
|---------|----------------|------|
| **API** | `backend/` | Express app via `api/index.js` |
| **Storefront** | `frontend/` | Vite React SPA + PWA (customers only) |
| **Launcher** | `launcher/` | Vite React SPA + serverless functions: admin, and publish to Daraz + QuantumStore |

If `backend/` and `frontend/` are git submodules, create each Vercel project from its own repository (simplest; no submodule PAT required).

```
Browser ──► Vercel Frontend (Vite)
               │  VITE_API_URL
               ▼
            Vercel Backend (Express serverless)
               ├── MongoDB Atlas
               ├── Google Drive (product images)
               ├── Stripe Checkout + webhook
               └── Resend / SMTP
```

## 1. MongoDB Atlas

1. Create a cluster and database user.
2. Network Access: allow `0.0.0.0/0` (required for Vercel serverless egress IPs).
3. Copy the connection string into `MONGODB_URI`.
4. Enable continuous backups / snapshots.

## 2. Image storage (required in production)

Local `uploads/` does **not** work on Vercel, so product images are stored in the owner's **Google Drive**. Each file is shared as "anyone with the link can view" and served from `lh3.googleusercontent.com` (full-size images are JPEG, which Daraz accepts).

One-time setup:

1. [Google Cloud Console](https://console.cloud.google.com) → create a project → **APIs & Services → Library → Google Drive API → Enable**.
2. **OAuth consent screen** → User type *External* → add the scope `.../auth/drive.file` → **Publish app** (status *In production*). A *Testing* app's refresh token expires after 7 days, which would silently break uploads.
3. **Credentials → Create credentials → OAuth client ID → Application type: Desktop app.** Copy the client ID and secret.
4. Put them in `backend/.env`:

   ```env
   GOOGLE_DRIVE_CLIENT_ID=...
   GOOGLE_DRIVE_CLIENT_SECRET=...
   ```

5. Run `npm run drive:auth --prefix backend`, sign in with the Google account that should hold the images and allow access. It creates a "QuantumStore Products" folder and prints the rest:

   ```env
   STORAGE_DRIVER=gdrive
   GOOGLE_DRIVE_REFRESH_TOKEN=...
   GOOGLE_DRIVE_FOLDER_ID=...
   ```

6. Add all five values (`STORAGE_DRIVER` plus the four `GOOGLE_DRIVE_*`) to the backend's Vercel environment variables and **redeploy**.

Google Drive is not a CDN: very high image traffic can be rate-limited by Google. That is fine for a small store; move to a real image host if traffic grows.

## 3. Backend (API) Vercel project

**Root:** `backend`  
**Build command:** leave empty or `npm install`  
**Output:** serverless via `api/index.js`  
**Install command:** `npm install`

Environment variables (see `backend/.env.example`):

| Variable | Notes |
|----------|--------|
| `NODE_ENV` | `production` |
| `MONGODB_URI` | Atlas URI |
| `JWT_SECRET` | 32+ random characters |
| `CLIENT_URL` | Frontend origin, e.g. `https://store.example.com` |
| `CORS_ORIGINS` | Comma-separated allowlist. **Required once the Launcher is deployed**: set it to the storefront origin *and* the Launcher origin (it replaces the `CLIENT_URL` default) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Seed once via `npm run seed` against Atlas |
| `STRIPE_*` | Secret, publishable, webhook secret |
| `RESEND_API_KEY` or `SMTP_*` | Transactional email |
| `STORAGE_DRIVER` | Must be `gdrive` |
| `GOOGLE_DRIVE_CLIENT_ID` / `_CLIENT_SECRET` / `_REFRESH_TOKEN` / `_FOLDER_ID` | See section 2 (`npm run drive:auth`) |
| `CRON_SECRET` | Shared secret for Vercel Cron |
| `SENTRY_DSN` | Optional |

`backend/vercel.json` rewrites all traffic to `/api` and schedules:

- `GET /api/cron/low-stock-digest` daily at 08:00 UTC
- `GET /api/cron/abandoned-carts` daily at 09:00 UTC — evaluates carts against the `abandonedCartHours` setting (Launcher → Settings)
- `GET /api/cron/audionic-sync` daily at 06:00 UTC — re-imports the Audionic catalog from audionic.co, priced Rs 100 below it (also on demand: Launcher → Products → **Sync Audionic now**)

All require `Authorization: Bearer <CRON_SECRET>` (Vercel Cron sends this automatically when `CRON_SECRET` is set — ensure the secret matches; the routes also accept `x-cron-secret`).

### Seed admin (once)

From your machine against Atlas:

```bash
cd backend
MONGODB_URI='mongodb+srv://...' ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run seed
```

Do **not** seed on every serverless cold start.

## 4. Frontend Vercel project

**Root:** `frontend`  
**Framework preset:** Vite  
**Build:** `npm run build`  
**Output:** `dist`

Environment:

```env
VITE_API_URL=https://your-api.vercel.app
```

Edit [`frontend/vercel.json`](../frontend/vercel.json) and replace `PLACEHOLDER_API_URL` with your real API origin for `/sitemap.xml` and `/robots.txt` rewrites.

## 4b. Launcher Vercel project

**Root:** `launcher`
**Framework preset:** Vite
**Build:** `npm run build`
**Output:** `dist` (the `api/` folder deploys as serverless functions; `/launcher-api/*` is rewritten to `/api/*` by `launcher/vercel.json`)

Environment (see `launcher/.env.example`):

| Variable | Notes |
|----------|--------|
| `VITE_API_URL` | Backend origin, e.g. `https://your-api.vercel.app` |
| `VITE_STORE_URL` | Storefront origin (the "View store" link) |
| `QUANTUM_API_URL` | Backend origin; functions use it to verify the signed-in owner |
| `MONGODB_URI` | Same Atlas URI as the API (stores the Daraz tokens and the product ↔ Daraz listing map) |
| `DARAZ_APP_KEY` / `DARAZ_APP_SECRET` | From the Daraz Open Platform app console. **Server-only** — never prefix with `VITE_` |
| `DARAZ_REDIRECT_URI` | `https://<launcher-host>/launcher-api/daraz/callback` — register the same URL in the Daraz app |
| `DARAZ_API_HOST` | Optional, defaults to `https://api.daraz.pk` |
| `GROQ_API_KEY` / `GROQ_MODEL` | Optional. Lets the AI pick the Daraz category and fill the English name/description/highlights, package size and required fields when you press Publish; server-only, never `VITE_` |

Do **not** set `LAUNCHER_AUTO_LOGIN_*` on Vercel — a deployed Launcher always asks for the owner's email and password (the backend's `ADMIN_EMAIL` / `ADMIN_PASSWORD`). `DARAZ_REDIRECT_URI` must be exactly a callback registered in the Daraz app; the registered `requestcatcher` address works with **Finish connecting** (paste the code or the whole redirected address).

After deploying: add the Launcher origin to the API's `CORS_ORIGINS`, open **Launcher → Settings → Connect Daraz**, and approve access with the seller account.

## 5. Stripe webhook

Point Stripe to:

`https://<your-api-host>/api/payments/webhook`

Events: `checkout.session.completed`. The webhook is the **only** writer of paid status.

## 6. Health & uptime

Monitor `GET /api/health`. Pair with Sentry (`SENTRY_DSN`) and structured logs (pino + `x-request-id`).

## 7. Legal pages

Storefront routes `/privacy`, `/terms`, and `/returns` must remain published before taking live payments.

## 8. Local development

```bash
npm run install:all
cp backend/.env.example backend/.env
npm run dev
```

- Storefront: http://localhost:5173  
- Launcher: http://localhost:5174 (`npm run dev:launcher`; copy `launcher/.env.example` → `launcher/.env`)  
- API: http://localhost:5000/api/health  

Local hosts still use `src/server.js` (`app.listen` + optional daily `setInterval` digest). Vercel uses the serverless entry + Cron instead.

## 9. Verification checklist

- [ ] `GET /api/health` returns `ok`
- [ ] Launcher login works and the storefront shows no admin entry point
- [ ] Launcher → Settings → Connect Daraz completes; Publish with both targets creates the product on QuantumStore and Daraz
- [ ] Product image upload lands in Google Drive and the `lh3.googleusercontent.com` URL renders
- [ ] Stripe test checkout + webhook marks order paid
- [ ] Both cron routes reject missing secret; succeed with Bearer token
- [ ] CORS allows only the storefront and Launcher origins
- [ ] Playwright e2e green locally (`npm run test:e2e`)
