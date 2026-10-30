import { requireOwner } from '../_lib/auth.js';
import { getCategoryAttributes } from '../_lib/daraz.js';
import { chatJson, groqConfigured } from '../_lib/groq.js';
import { HttpError, route } from '../_lib/http.js';
import { logLine } from '../_lib/log.js';
import { readKnownListing } from '../../shared/knownListing.js';
import {
  attributeRole,
  composeAttributes,
  draftFromKnown,
  listingMessages,
  readListingAnswer,
  requiredAttributes,
  type ListingDraft,
  type ListingProduct,
} from '../_lib/listingAi.js';
import { suggestCategories } from '../_lib/suggestCategories.js';

type Body = {
  name?: string;
  brand?: string;
  description?: string;
  specs?: Array<{ key: string; value: string }>;
  categoryId?: number | null;
  /** Values the seller already typed for the category's fields; they are never overwritten. */
  attributes?: Record<string, string>;
  /** A ready-made description, highlights and package size (see shared/knownListing.ts); the AI is not asked for those. */
  known?: unknown;
};

/**
 * One call that prepares the Daraz side of a listing: picks the category when none is chosen, then writes the
 * English name/description/highlights, estimates the package size and fills the category's required fields.
 * Without a GROQ_API_KEY the plain product details are used and whatever is left is reported as `missing`.
 */
export default route('POST', async (req, res) => {
  await requireOwner(req);

  const body = (req.body || {}) as Body;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  if (name.length < 2 || name.length > 200) throw new HttpError(400, 'Enter the product name first');
  const product: ListingProduct = {
    name,
    brand: typeof body.brand === 'string' ? body.brand.trim().slice(0, 100) : '',
    description,
    specs: Array.isArray(body.specs) ? body.specs.filter((s) => s && s.key && s.value).slice(0, 15) : [],
  };
  const typed = Object.fromEntries(
    Object.entries(body.attributes || {}).filter(([, v]) => typeof v === 'string' && v.trim()),
  ) as Record<string, string>;
  const ai = groqConfigured();

  let category: { id: number; name: string; path: string } | null = null;
  let categoryId = Number(body.categoryId) || 0;
  if (!categoryId && ai) {
    const found = await suggestCategories({ ...product, description: description.slice(0, 300) });
    category = found.suggestions[0] ?? null;
    categoryId = category?.id ?? 0;
  }
  if (!categoryId) {
    res.status(200).json({ ok: true, category: null, attributes: typed, package: null, missing: [] });
    return;
  }

  const required = requiredAttributes(await getCategoryAttributes(categoryId), typed);
  const known = readKnownListing(body.known);
  let draft: ListingDraft | null = null;
  // With a ready-made entry the AI is only needed for the category's other required fields, and only if there are any.
  const asked = required.filter((a) => !attributeRole(a));
  if (ai && (!known || asked.length)) {
    try {
      draft = readListingAnswer(await chatJson(listingMessages(product, asked), { maxTokens: 2048, timeoutMs: 30_000 }), asked);
    } catch (err) {
      // A rate limit or bad key should be shown; an unreadable answer just leaves the fields for the seller.
      // When the text and package size are already known, a failed AI call only costs the other fields.
      if (!known && err instanceof HttpError && err.status !== 502) throw err;
      if (known) logLine(`prepare listing: the AI could not fill the other fields (${err instanceof Error ? err.message : err})`);
    }
  }
  if (known) draft = draftFromKnown(known, draft);

  const { values, missing } = composeAttributes(required, product, draft);
  logLine(
    `prepare listing: "${product.name}" category ${categoryId} — ${Object.keys(values).length} fields filled, package ${draft?.package ? (known ? 'from the ready-made data' : 'estimated') : 'NOT estimated'}` +
      (missing.length ? `, missing: ${missing.map((a) => a.label).join(', ')}` : ''),
  );
  res.status(200).json({
    ok: true,
    category,
    attributes: { ...values, ...typed },
    package: draft?.package ?? null,
    description: draft?.description ?? '',
    missing: missing.map((a) => ({ name: a.name, label: a.label })),
  });
});
