# QuantumStore

MERN ecommerce for **Quantum Logics Limited** — production-oriented storefront + admin panel.

## Stack

- **MongoDB** — Atlas (or any durable URI) by default; `USE_MEMORY_DB=true` for local demo only
- **Express 5 + TypeScript** — layered API (`routes` → `controllers` → `services` → `models`), Vercel serverless-ready
- **React 19 (Vite) + TypeScript** — storefront + admin, TanStack Query, internal UI kit
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
- Admin: sign in at http://localhost:5173/login — admin/staff accounts are redirected to `/admin` automatically  
- API health: http://localhost:5000/api/health  

Admin/staff sign in through the normal login form; access to `/admin` is granted purely by the account's `role` in the database (never by a client-supplied value). Provision the initial admin with `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env` plus `npm run create-admin` (see `.env.example`).

> Production **must not** use `USE_MEMORY_DB`. Deploy on **Vercel** (API + storefront) — see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Scripts

```bash
npm run dev          # backend + frontend
npm test             # backend Vitest
npm run build        # frontend production build
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
├── frontend/           React storefront + admin (submodule)
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
