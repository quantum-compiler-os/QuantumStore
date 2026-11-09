import { requireOwner } from '../_lib/auth.js';
import { pakbooksCollection } from '../_lib/db.js';
import { route } from '../_lib/http.js';
import { logLine } from '../_lib/log.js';
import { fetchPakbooksItems } from '../_lib/pakbooks.js';

/** PakBooks' catalog as listable items, plus what has already been synced (to tell new, changed and removed apart). */
export default route('GET', async (req, res) => {
  await requireOwner(req);
  const { items, fetched } = await fetchPakbooksItems();
  logLine(`pakbooks catalog: ${items.length} books ready (${fetched - items.length} skipped: no price or picture)`);
  const links = await (await pakbooksCollection()).find({}).toArray();
  res.status(200).json({
    ok: true,
    fetched,
    items,
    links: links.map(({ pakbooksId, quantumProductId, darazItemId, sellerSku, sourcePkr, available }) => ({
      pakbooksId,
      quantumProductId,
      darazItemId,
      sellerSku,
      sourcePkr,
      available,
    })),
  });
});
