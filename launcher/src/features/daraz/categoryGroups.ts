import type { DarazCategoryLeaf } from '../../api/daraz';
import { groupOf } from '../../../shared/commission';

// The commission table and price formula live in shared/ so the sync (server side) uses the same ones.
export * from '../../../shared/commission';

/** The distinct level-1 groups present in Daraz's category tree, alphabetical. */
export function groupsFromLeaves(leaves: DarazCategoryLeaf[]) {
  return [...new Set(leaves.map((l) => groupOf(l.path)))].sort((a, b) => a.localeCompare(b));
}

/** Leaves inside `group` (all groups when empty) that contain every word of `query`, capped for display. */
export function filterLeaves(leaves: DarazCategoryLeaf[], group: string, query: string, limit = 60) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const inGroup = group ? leaves.filter((l) => groupOf(l.path) === group) : leaves;
  if (!words.length && !group) return [];
  const hits = inGroup.filter((l) => {
    const path = l.path.toLowerCase();
    return words.every((w) => path.includes(w));
  });
  return hits.slice(0, limit);
}
