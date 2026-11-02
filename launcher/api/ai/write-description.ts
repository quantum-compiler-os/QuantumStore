import { requireOwner } from '../_lib/auth.js';
import { chatJson } from '../_lib/groq.js';
import { HttpError, route } from '../_lib/http.js';
import { descriptionMessages, readDescriptionAnswer } from '../_lib/listingAi.js';

/** Writes the product description for Publish, from the name, brand and specs. */
export default route('POST', async (req, res) => {
  await requireOwner(req);

  const body = req.body || {};
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name.length < 2) throw new HttpError(400, 'Enter the product name first');
  const product = {
    name,
    brand: typeof body.brand === 'string' ? body.brand.trim().slice(0, 100) : '',
    specs: Array.isArray(body.specs) ? body.specs.filter((s: { key?: string; value?: string }) => s && s.key && s.value).slice(0, 15) : [],
  };

  const description = readDescriptionAnswer(await chatJson(descriptionMessages(product), { maxTokens: 600, timeoutMs: 30_000 }));
  if (!description) throw new HttpError(502, 'The AI did not write a usable description — press Publish again');
  res.status(200).json({ ok: true, description });
});
