import { requireOwner } from '../_lib/auth.js';
import { fetchCamshamItems } from '../_lib/camsham.js';
import { camshamCollection } from '../_lib/db.js';
import { route } from '../_lib/http.js';

/** CamSham's catalog as listable items, plus what has already been synced (to tell new, changed and removed apart). */
export default route('GET', async (req, res) => {
  await requireOwner(req);
  const { items, fetched } = await fetchCamshamItems();
  const links = await (await camshamCollection()).find({}).toArray();
  res.status(200).json({
    ok: true,
    fetched,
    items,
    links: links.map(({ camshamId, quantumProductId, darazItemId, sellerSku, sourcePkr, available }) => ({
      camshamId,
      quantumProductId,
      darazItemId,
      sellerSku,
      sourcePkr,
      available,
    })),
  });
});
