import {
  MAX_SUGGESTIONS,
  SHORTLIST_SIZE,
  distinctGroups,
  groupMessages,
  groupOfPath,
  leafMessages,
  rankLeaves,
  readGroupAnswer,
  readPicks,
  tokenize,
  type ProductInfo,
} from './categorySuggest.js';
import { getCategoryLeaves } from './daraz.js';
import { chatJson } from './groq.js';
import { HttpError } from './http.js';

/**
 * Daraz categories for a product, best match first. Two small Groq calls (group + keywords, then a pick from a
 * locally ranked shortlist) instead of sending the whole category tree; if the second call fails the
 * local ranking is returned so the seller still gets something useful.
 */
export async function suggestCategories(product: ProductInfo) {
  const leaves = await getCategoryLeaves();
  if (!leaves.length) throw new HttpError(502, 'Daraz returned no categories');
  const groups = distinctGroups(leaves);

  const stage1 = readGroupAnswer(await chatJson(groupMessages(groups, product)), groups);
  const pool = stage1.group ? leaves.filter((l) => groupOfPath(l.path) === stage1.group) : leaves;
  const keywords = [...new Set([...stage1.keywords, ...tokenize(product.name), ...tokenize(product.brand || '')])];
  const shortlist = rankLeaves(pool, keywords, SHORTLIST_SIZE);
  if (!shortlist.length) return { group: stage1.group, suggestions: [] };

  let picks = shortlist.slice(0, MAX_SUGGESTIONS);
  try {
    const chosen = readPicks(await chatJson(leafMessages(shortlist, product)), shortlist);
    if (chosen.length) picks = chosen;
  } catch (err) {
    // A rate limit or key problem should surface; a bad answer just falls back to the local ranking.
    if (err instanceof HttpError && err.status !== 502) throw err;
  }

  return {
    group: stage1.group,
    suggestions: picks.map((leaf) => ({ id: leaf.id, name: leaf.name, path: leaf.path })),
  };
}
