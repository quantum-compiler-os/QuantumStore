# QuantumStore

MERN ecommerce for **Quantum Logics Limited** — production-oriented storefront, plus the **Launcher**: a separate staff site that runs the admin and publishes products to Daraz and QuantumStore at once.

## Stack

- **MongoDB** — Atlas (or any durable URI) by default; `USE_MEMORY_DB=true` for local demo only
- **Express 5 + TypeScript** — layered API (`routes` → `controllers` → `services` → `models`), Vercel serverless-ready
- **React 19 (Vite) + TypeScript** — customer storefront (`frontend/`) and staff Launcher (`launcher/`), TanStack Query
- **Stripe** — card checkout; **webhook is the source of truth** for payment status
- **Resend or SMTP** — transactional email
- **Cloudinary** — product images (required in production / Vercel)
- **Vitest + Playwright** — API and end-to-end tests
- **Vercel** — separate frontend + API projects (see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md))

## Quick start (local demo)

```bash
npm install
npm run install:all
cp backend/.env.example backend/.env
npm run dev
```

- Storefront: http://localhost:5173  
- Launcher (admin + publishing): http://localhost:5174 — `npm run dev:launcher` (starts the backend too), or everything with `npm run dev:all`  
- API health: http://localhost:5000/api/health  

The storefront has no admin UI. Staff sign in at the Launcher with the same API credentials; access is granted purely by the account's `role` and the owner email in the database (enforced by the API on every call, never by a client-supplied value). Provision the initial admin with `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env` plus `npm run create-admin` (see `.env.example`). The Launcher's origin must be listed in the API's `CORS_ORIGINS`.

See [launcher/README.md](launcher/README.md) for connecting Daraz and publishing.

> Production **must not** use `USE_MEMORY_DB`. Deploy on **Vercel** (API + storefront) — see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Scripts

```bash
npm run dev          # backend + storefront
npm run dev:all      # backend + storefront + launcher
npm test             # backend Vitest
npm run test:launcher  # launcher Vitest (Daraz signing, XML, OAuth state)
npm run build        # storefront production build
npm run build:launcher # launcher production build
npm run test:e2e     # Playwright
npm run seed         # reseed database
```

## Production readiness highlights

- Zod env validation at API startup; weak JWT / memory DB blocked in production
- Authenticated/owned Stripe checkout sessions; client cannot mark orders paid
- CORS allowlist, payment rate limits, structured logging (pino), optional Sentry
- Image storage abstraction (`STORAGE_DRIVER=local|cloudinary`)
- Legal pages: `/privacy`, `/terms`, `/returns`

## CI

GitHub Actions runs typecheck (soft), Vitest, frontend build, and Playwright on push/PR.

**Submodules:** `backend/` and `frontend/` are private. Without a `SUBMODULE_PAT` secret (Contents: Read on both submodule repos), checkout leaves those folders empty and `npm run install:all` fails with `ENOENT .../backend/package.json`.

## Project structure

```
QuantumStore/
├── frontend/           React storefront (submodule)
├── launcher/           Staff site: admin + publish to Daraz & QuantumStore
├── backend/            Express API (submodule)
├── e2e/                Playwright specs
├── docs/DEPLOYMENT.md  Hosting guide (Atlas, Stripe, Cloudinary)
├── .github/workflows/  CI
└── package.json
```

## Environment

Copy [`backend/.env.example`](backend/.env.example) → `backend/.env`. For Atlas:

```env
USE_MEMORY_DB=false
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/quantumstore
JWT_SECRET=use_a_long_random_secret_32chars_min
CLIENT_URL=https://your-domain
ADMIN_EMAIL=you@company.com
ADMIN_PASSWORD=strong-password-here
```
