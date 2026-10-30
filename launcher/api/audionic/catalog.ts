import { fetchAudionicItems } from '../_lib/audionic.js';
import { requireOwner } from '../_lib/auth.js';
import { audionicCollection } from '../_lib/db.js';
import { route } from '../_lib/http.js';

/** Audionic's catalog as listable items, plus what has already been synced (to tell new, changed and removed apart). */
export default route('GET', async (req, res) => {
  await requireOwner(req);
  const { items, fetched } = await fetchAudionicItems();
  const links = await (await audionicCollection()).find({}).toArray();
  res.status(200).json({
    ok: true,
    fetched,
    items,
    links: links.map(({ audionicId, quantumProductId, darazItemId, sellerSku, sourcePkr, available }) => ({
      audionicId,
      quantumProductId,
      darazItemId,
      sellerSku,
      sourcePkr,
      available,
    })),
  });
});
