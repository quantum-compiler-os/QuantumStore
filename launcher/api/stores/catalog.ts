import { requireOwner } from '../_lib/auth.js';
import { storeLinkCollection } from '../_lib/db.js';
import { queryString, route } from '../_lib/http.js';
import { logLine } from '../_lib/log.js';
import { fetchStoreItems } from '../_lib/storeFetcher.js';

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** One shop's catalog as listable items, plus what has already been synced from that shop (new, changed and removed). */
export default route('GET', async (req, res) => {
  await requireOwner(req);
  const { store, items, fetched } = await fetchStoreItems(queryString(req, 'store'));
  logLine(
    `store fetcher: ${store.host} (${store.platform}, ${store.currency ?? 'currency not stated, taken as PKR'}) — ` +
      `${items.length} products ready (${fetched - items.length} skipped: no price or picture)`,
  );
  const links = await (await storeLinkCollection()).find({ storeProductId: { $regex: `^${escapeRegExp(store.host)}/` } }).toArray();
  res.status(200).json({
    ok: true,
    store,
    fetched,
    items,
    links: links.map(({ storeProductId, quantumProductId, darazItemId, sellerSku, sourcePkr, available }) => ({
      storeProductId,
      quantumProductId,
      darazItemId,
      sellerSku,
      sourcePkr,
      available,
    })),
  });
});
