import { requireOwner } from '../_lib/auth.js';
import { HttpError, route } from '../_lib/http.js';
import { suggestCategories } from '../_lib/suggestCategories.js';

/** Suggests Daraz categories for a product name (see suggestCategories). */
export default route('POST', async (req, res) => {
  await requireOwner(req);

  const body = req.body || {};
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name.length < 2 || name.length > 200) throw new HttpError(400, 'Enter the product name first');
  const product = {
    name,
    brand: typeof body.brand === 'string' ? body.brand.trim().slice(0, 100) : '',
    description: typeof body.description === 'string' ? body.description.trim().slice(0, 300) : '',
  };

  res.status(200).json({ ok: true, ...(await suggestCategories(product)) });
});
