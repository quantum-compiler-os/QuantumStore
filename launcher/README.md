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

Set `GROQ_API_KEY` in `launcher/.env` (create one at https://console.groq.com/keys; `GROQ_MODEL` is optional, default `openai/gpt-oss-120b`) and restart. **Publish** is a single button that sends the product to QuantumStore and, once Daraz is connected, to Daraz as well. When you press it, the AI picks the Daraz category (unless you chose one), writes the English name, description and highlights, estimates the package size of one unit, and fills the category's other required fields (for example Age Group). Nothing you typed is overwritten; open **Daraz details** to review or change anything. If Daraz requires an ISBN/ISSN and the AI is not certain of the real one, a random well-formed number is generated (it may not match the real book; type the real one under **Daraz details** to override it). Without a Groq key the Daraz category and package size are entered by hand.

The key stays on the server. Groq never receives the whole category tree: one call picks the Daraz group and keywords, the group's categories are ranked locally, and a second call picks from a shortlist of 40. Every answer is checked against the real category list, so an invented category can't be selected. Each suggestion costs two short Groq requests.

## Publish a product

**Publish** has one form and one button. Images upload to Google Drive through the backend (`POST /api/uploads`). The product goes to QuantumStore and, once Daraz is connected, to Daraz too; the AI fills the Daraz category and the other Daraz fields (see above), and everything can be reviewed under **Daraz details**.

1. The product is created on QuantumStore (`POST /api/products`).
2. Daraz re-hosts the images, then the product is created there. The mapping (`launcher_listings`) records the Daraz item id.

If Daraz rejects the listing, the QuantumStore product stays and the button becomes **Retry Daraz** — it does not create a second store product.

Notes:

- **Prices.** You type rupees. QuantumStore stores them divided by the PKR rate from Settings (the storefront multiplies by it again), so 8000 shows as Rs 8,000. Daraz gets the price that still leaves your price after Daraz's category commission: `daraz price = price ÷ (1 − commission%)`, rounded up (Rs 8,000 at 14.8% → Rs 9,390). A "Custom Daraz price" overrides it.
- Daraz needs publicly reachable `https` image URLs. With `STORAGE_DRIVER=local` (relative `/uploads/…` paths) the Daraz step will refuse; use Google Drive or paste hosted URLs.
- Editing a product that is on Daraz sends its images to Daraz as well; other edits are not pushed. Deleting it also removes the Daraz listing (leftovers can be removed from **Products → Listed on Daraz**).

## Audionic sync

**Audionic** (side menu) reads audionic.co's public catalog and lists the products on QuantumStore **and** Daraz. It runs only when you press the button, from the Launcher; the backend no longer has an Audionic sync or cron.

- **Prices.** QuantumStore gets Audionic's price exactly (no deduction). Daraz gets it through the commission formula above.
- **Categories.** The QuantumStore category is Audio or Accessories. For Daraz, one category is chosen per Audionic type (Earbuds, Speakers, Power Banks…): the AI suggests it, you can change it, and the choice is remembered in the browser.
- **Daraz.** Available items go up with a quantity of 10 (Audionic does not say how many it has), one SKU per product at its lowest price, brand Audionic (falls back to "No Brand" if Daraz does not know it), and a deterministic SKU `AUD-<id>` so a repeat never lists it twice. Sold-out items are created on QuantumStore only.
- **Re-sync.** What was synced is remembered in `launcher_audionic`. A later run creates new products and, when Audionic changed a price or availability, refreshes the QuantumStore product (price, stock, pictures). Daraz listings are not updated. Items Audionic dropped can be marked sold out with one button. A product that failed on Daraz keeps its QuantumStore half and is picked up again as "Not on Daraz".

Try it with two or three products first (untick the rest), check them on both sites, then sync the rest.

## Layout

| Path | Purpose |
|------|---------|
| `src/` | React app (the admin pages moved here from the storefront) |
| `src/pages/admin/Publish.tsx` | The publish form |
| `src/features/products/` | Product form fields + payload builder shared by Publish and Edit |
| `api/daraz/*` | Serverless endpoints: connect, callback, exchange, status, categories, attributes, listings, publish, update-images, update-offer (price and stock), remove |
| `api/audionic/*`, `api/_lib/audionic.ts` | Audionic catalog reader (pure, unit-tested) and the link table endpoints |
| `src/pages/admin/Audionic.tsx`, `src/features/audionic/` | The Audionic sync page and its per-product sync |
| `api/_lib/darazCore.ts` | Pure helpers: request signing, XML builders, image URL rewrite (unit-tested) |
| `api/_lib/daraz.ts` | Daraz HTTP client, token refresh |
| `tests/` | `npm test` |

## Daraz API contract

The signing scheme (HMAC-SHA256 over the API path plus sorted key/value pairs), the `/auth/token/*`, `/category/*`, `/image/migrate` and `/product/create` calls follow the Lazada-family Open Platform that Daraz uses. If Daraz rejects a call, compare it against the current docs at open.daraz.com; the request-building code is confined to `api/_lib/darazCore.ts` and `api/_lib/daraz.ts`.
