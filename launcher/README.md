# Launcher

Staff site for QuantumStore. It is the admin (dashboard, orders, coupons, customers, …) and the place to **publish a product to Daraz and QuantumStore in one step**. The customer storefront (`../frontend`) has no admin UI.

## Run it

```bash
cd launcher
cp .env.example .env     # fill in the Daraz + MongoDB values
npm install
npm run dev              # http://127.0.0.1:5174 (backend must be running on :5000)
```

`npm run dev` serves the `api/` functions under `/launcher-api/*` through a small Vite plugin, so `vercel dev` is not needed.

On your own computer there is no login screen: with `LAUNCHER_AUTO_LOGIN_EMAIL` / `LAUNCHER_AUTO_LOGIN_PASSWORD` set in `launcher/.env` (the backend's `ADMIN_EMAIL` / `ADMIN_PASSWORD`), the Launcher signs in as the owner by itself. This only works for a browser on the same machine and is refused on Vercel, so a deployed Launcher always asks for the owner's email and password. Logging out shows the login page for the rest of that browser tab; a new tab signs in automatically again. The Launcher origin must be in the backend's `CORS_ORIGINS` in production; in dev the Vite proxy forwards `/api` to `:5000`, so no CORS setup is needed.

## Connect Daraz (once)

1. In the Daraz Open Platform app console, add `DARAZ_REDIRECT_URI` (`http://127.0.0.1:5174/launcher-api/daraz/callback` locally) as a callback URL.
2. Put `DARAZ_APP_KEY`, `DARAZ_APP_SECRET`, `DARAZ_REDIRECT_URI` and `MONGODB_URI` in `launcher/.env`.
3. **Settings → Connect Daraz**, approve access with the seller account. Tokens are stored in the `launcher_daraz` collection and refreshed automatically.

## Publish a product

**Publish** has one form. Images upload to Cloudinary through the backend (`POST /api/uploads`). Tick **QuantumStore** and/or **Daraz**, pick a Daraz category, fill the package size, and press **Publish**.

1. The product is created on QuantumStore (`POST /api/products`).
2. Daraz re-hosts the images, then the product is created there. The mapping (`launcher_listings`) records the Daraz item id.

If Daraz rejects the listing, the QuantumStore product stays and the button becomes **Retry Daraz** — it does not create a second store product.

Notes:

- Daraz prices are rupees. The default Daraz price is the store price converted with the PKR rate from Settings; override it in the Daraz panel.
- Daraz needs publicly reachable `https` image URLs. With `STORAGE_DRIVER=local` (relative `/uploads/…` paths) the Daraz step will refuse; use Cloudinary or paste hosted URLs.
- Later edits to price or stock on QuantumStore are not pushed to Daraz yet.

## Layout

| Path | Purpose |
|------|---------|
| `src/` | React app (the admin pages moved here from the storefront) |
| `src/pages/admin/Publish.tsx` | The publish form |
| `src/features/products/` | Product form fields + payload builder shared by Publish and Edit |
| `api/daraz/*` | Serverless endpoints: connect, callback, status, categories, attributes, listings, publish |
| `api/_lib/darazCore.ts` | Pure helpers: request signing, XML builders, image URL rewrite (unit-tested) |
| `api/_lib/daraz.ts` | Daraz HTTP client, token refresh |
| `tests/` | `npm test` |

## Daraz API contract

The signing scheme (HMAC-SHA256 over the API path plus sorted key/value pairs), the `/auth/token/*`, `/category/*`, `/image/migrate` and `/product/create` calls follow the Lazada-family Open Platform that Daraz uses. If Daraz rejects a call, compare it against the current docs at open.daraz.com; the request-building code is confined to `api/_lib/darazCore.ts` and `api/_lib/daraz.ts`.
