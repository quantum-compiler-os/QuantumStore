# Launcher

Staff site for QuantumStore. It is the admin (dashboard, orders, coupons, customers, …) and the place to **publish a product to Daraz and QuantumStore in one step**. The customer storefront (`../frontend`) has no admin UI.

## Run it

```bash
cd launcher
cp .env.example .env     # fill in the Daraz + MongoDB values
npm install
npm run dev              # http://127.0.0.1:5174, publishes to the deployed backend (QUANTUM_API_URL)
```

`npm run dev` serves the `api/` functions under `/launcher-api/*` through a small Vite plugin, so `vercel dev` is not needed.

On your own computer there is no login screen: with `LAUNCHER_AUTO_LOGIN_EMAIL` / `LAUNCHER_AUTO_LOGIN_PASSWORD` set in `launcher/.env` (the backend's `ADMIN_EMAIL` / `ADMIN_PASSWORD`), the Launcher signs in as the owner by itself. This only works for a browser on the same machine and is refused on Vercel, so a deployed Launcher always asks for the owner's email and password. Logging out shows the login page for the rest of that browser tab; a new tab signs in automatically again. The Launcher origin must be in the backend's `CORS_ORIGINS` in production; in dev the Vite proxy forwards `/api` to `:5000`, so no CORS setup is needed.

## Connect Daraz (once)

1. Put `DARAZ_APP_KEY`, `DARAZ_APP_SECRET`, `DARAZ_REDIRECT_URI` and `MONGODB_URI` in `launcher/.env`. `DARAZ_REDIRECT_URI` must equal the callback URL registered in your Daraz app (Daraz answers "Redirect uri does not match the callback url of the APP" otherwise). The Settings page shows the value the Launcher is sending.
2. **Settings → Connect Daraz** (or the button on **Publish**). Daraz opens in a new tab; approve access with the seller account.
3. If the registered callback is the Launcher's own (`/launcher-api/daraz/callback`), the Launcher finishes by itself. If it is something else (for example a request-catcher page), Daraz sends you there with `?code=…` in the address: copy that address (or just the code) and paste it into **Finish connecting**. The code is single-use and expires after 30 minutes.

Tokens are stored in the `launcher_daraz` collection and refreshed automatically.

## Category suggestions (Groq)

Set `GROQ_API_KEY` in `launcher/.env` (create one at https://console.groq.com/keys; `GROQ_MODEL` is optional, default `openai/gpt-oss-120b`) and restart. On **Publish** with Daraz ticked, a "Suggested for this product" card proposes up to three Daraz categories from the product name (plus brand and description). It runs by itself a moment after you stop typing the name, while no category is chosen yet, and again on demand with **Suggest again**. Click a suggestion to select it.

The key stays on the server. Groq never receives the whole category tree: one call picks the Daraz group and keywords, the group's categories are ranked locally, and a second call picks from a shortlist of 40. Every answer is checked against the real category list, so an invented category can't be selected. Each suggestion costs two short Groq requests.

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
| `api/daraz/*` | Serverless endpoints: connect, callback, exchange, status, categories, attributes, listings, publish |
| `api/_lib/darazCore.ts` | Pure helpers: request signing, XML builders, image URL rewrite (unit-tested) |
| `api/_lib/daraz.ts` | Daraz HTTP client, token refresh |
| `tests/` | `npm test` |

## Daraz API contract

The signing scheme (HMAC-SHA256 over the API path plus sorted key/value pairs), the `/auth/token/*`, `/category/*`, `/image/migrate` and `/product/create` calls follow the Lazada-family Open Platform that Daraz uses. If Daraz rejects a call, compare it against the current docs at open.daraz.com; the request-building code is confined to `api/_lib/darazCore.ts` and `api/_lib/daraz.ts`.
