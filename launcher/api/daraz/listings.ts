import { requireOwner } from '../_lib/auth';
import { listingCollection } from '../_lib/db';
import { queryString, route } from '../_lib/http';

/** Which of the given QuantumStore product ids are already listed on Daraz. */
export default route('GET', async (req, res) => {
  await requireOwner(req);
  const ids = queryString(req, 'ids')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, 100);
  const listings: Record<string, { itemId: string; sellerSku: string }> = {};
  if (ids.length) {
    const rows = await (await listingCollection()).find({ quantumProductId: { $in: ids } }).toArray();
    for (const row of rows) listings[row.quantumProductId] = { itemId: row.darazItemId, sellerSku: row.sellerSku };
  }
  res.status(200).json({ ok: true, listings });
});
