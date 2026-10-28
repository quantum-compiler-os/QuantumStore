import { requireOwner } from '../_lib/auth.js';
import { getCategoryAttributes } from '../_lib/daraz.js';
import { AUTO_ATTRIBUTES } from '../_lib/darazCore.js';
import { HttpError, queryString, route } from '../_lib/http.js';

/** Category attributes the seller still has to supply (the launcher fills the rest itself). */
export default route('GET', async (req, res) => {
  await requireOwner(req);
  const categoryId = Number(queryString(req, 'categoryId'));
  if (!Number.isInteger(categoryId) || categoryId <= 0) throw new HttpError(400, 'categoryId is required');
  const attributes = (await getCategoryAttributes(categoryId)).filter((a) => !AUTO_ATTRIBUTES.has(a.name));
  res.status(200).json({ ok: true, attributes });
});
