import { requireOwner } from '../_lib/auth.js';
import { listingCollection } from '../_lib/db.js';
import { queryString, route } from '../_lib/http.js';

/** Which of the given QuantumStore product ids are already listed on Daraz. */
export default route('GET', async (req, res) => {
  await requireOwner(req);
  if (queryString(req, 'all') === '1') {
    const rows = await (await listingCollection()).find({}).sort({ createdAt: -1 }).limit(200).toArray();
    res.status(200).json({
      ok: true,
      all: rows.map((row) => ({
        quantumProductId: row.quantumProductId,
        itemId: row.darazItemId,
        sellerSku: row.sellerSku,
        createdAt: row.createdAt,
      })),
    });
    return;
  }
  const ids = queryString(req, 'ids')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, 100);
  const listings: Record<string, { itemId: string; sellerSku: string; categoryId: number }> = {};
  if (ids.length) {
    const rows = await (await listingCollection()).find({ quantumProductId: { $in: ids } }).toArray();
    for (const row of rows) {
      listings[row.quantumProductId] = { itemId: row.darazItemId, sellerSku: row.sellerSku, categoryId: row.categoryId };
    }
  }
  res.status(200).json({ ok: true, listings });
});
