import { requireOwner } from '../_lib/auth';
import {
  SHORTLIST_SIZE,
  distinctGroups,
  groupMessages,
  groupOfPath,
  leafMessages,
  rankLeaves,
  readGroupAnswer,
  readPicks,
  tokenize,
  MAX_SUGGESTIONS,
} from '../_lib/categorySuggest';
import { getCategoryLeaves } from '../_lib/daraz';
import { chatJson } from '../_lib/groq';
import { HttpError, route } from '../_lib/http';

/**
 * Suggests Daraz categories for a product. Two small Groq calls (group + keywords, then a pick from a
 * locally ranked shortlist) instead of sending the whole category tree; if the second call fails the
 * local ranking is returned so the seller still gets something useful.
 */
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

  const leaves = await getCategoryLeaves();
  if (!leaves.length) throw new HttpError(502, 'Daraz returned no categories');
  const groups = distinctGroups(leaves);

  const stage1 = readGroupAnswer(await chatJson(groupMessages(groups, product)), groups);
  const pool = stage1.group ? leaves.filter((l) => groupOfPath(l.path) === stage1.group) : leaves;
  const keywords = [...new Set([...stage1.keywords, ...tokenize(product.name), ...tokenize(product.brand)])];
  const shortlist = rankLeaves(pool, keywords, SHORTLIST_SIZE);
  if (!shortlist.length) {
    res.status(200).json({ ok: true, group: stage1.group, suggestions: [] });
    return;
  }

  let picks = shortlist.slice(0, MAX_SUGGESTIONS);
  try {
    const chosen = readPicks(await chatJson(leafMessages(shortlist, product)), shortlist);
    if (chosen.length) picks = chosen;
  } catch (err) {
    // A rate limit or key problem should surface; a bad answer just falls back to the local ranking.
    if (err instanceof HttpError && err.status !== 502) throw err;
  }

  res.status(200).json({
    ok: true,
    group: stage1.group,
    suggestions: picks.map((leaf) => ({ id: leaf.id, name: leaf.name, path: leaf.path })),
  });
});
