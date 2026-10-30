import type { DarazCategoryLeaf } from '../../api/daraz';
import { filterLeaves } from '../daraz/categoryGroups';

const AUDIO = 'TV, Audio / Video, Gaming & Wearables';

/**
 * Daraz categories for each Audionic type, chosen by hand, used while the AI cannot answer (rate limit, no key). Each entry
 * is a group plus the words to look for in the category path, most wanted first; the first leaf found is used. The result
 * is only a starting point: the seller still sees it in the picker and can change it.
 */
const RULES: Record<string, Array<{ group: string; query: string }>> = {
  Speakers: [
    { group: AUDIO, query: 'bluetooth speaker' },
    { group: AUDIO, query: 'portable speaker' },
    { group: AUDIO, query: 'speaker' },
  ],
  Earbuds: [{ group: AUDIO, query: 'wireless earbuds' }, { group: AUDIO, query: 'earbuds' }],
  Earphones: [{ group: AUDIO, query: 'in-ear' }, { group: AUDIO, query: 'earphones' }],
  // No broader word: "headphones" also appears in the path of the earbuds and in-ear categories.
  Headphones: [{ group: AUDIO, query: 'over-the-ear' }],
  'Power Banks': [{ group: 'Mobiles & Tablets', query: 'power banks' }],
};

export function fallbackCategory(type: string, leaves: DarazCategoryLeaf[]): DarazCategoryLeaf | null {
  for (const rule of RULES[type] ?? []) {
    const [hit] = filterLeaves(leaves, rule.group, rule.query, 1);
    if (hit) return hit;
  }
  return null;
}
