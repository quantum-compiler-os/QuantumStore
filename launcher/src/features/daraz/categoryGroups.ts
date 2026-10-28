import type { DarazCategoryLeaf } from '../../api/daraz';

/** Separator the API uses between breadcrumb levels (see flattenCategoryTree in api/_lib/darazCore.ts). */
const PATH_SEPARATOR = ' › ';

/**
 * Daraz Seller Center's level-1 categories and their commission (%), copied from its commission table.
 * Names are matched loosely against the category tree Daraz returns; the tree supplies the IDs.
 */
export const DARAZ_LEVEL1_COMMISSION: ReadonlyArray<{ name: string; commission: number }> = [
  { name: 'Test ID 2', commission: 4.0 },
  { name: 'Bedding & Bath', commission: 14.8 },
  { name: 'Furniture & Decor', commission: 14.8 },
  { name: 'Tools, DIY & Outdoor', commission: 14.35 },
  { name: 'Laundry & Cleaning', commission: 14.35 },
  { name: 'Kitchen & Dining', commission: 14.8 },
  { name: 'Stationery & Craft', commission: 4.8 },
  { name: 'Sample', commission: 3.65 },
  { name: 'Special Digital Products', commission: 2.65 },
  { name: 'Topup', commission: 3.65 },
  { name: 'Service Product', commission: 1.0 },
  { name: 'Test Product2', commission: 16.0 },
  { name: 'Charity and Donation', commission: 0.0 },
  { name: 'Pet Supplies', commission: 10.04 },
  { name: 'Health & Beauty', commission: 14.44 },
  { name: 'TV, Audio / Video, Gaming & Wearables', commission: 8.6 },
  { name: 'Fashion', commission: 18.5 },
  { name: 'Bags and Travel', commission: 17.0 },
  { name: 'Sports & Outdoors', commission: 9.55 },
  { name: 'Mobiles & Tablets', commission: 12.9 },
  { name: 'Packaging Material', commission: 2.95 },
  { name: 'OPS Services', commission: 3.65 },
  { name: 'Cameras', commission: 5.1 },
  { name: 'Home Appliances', commission: 4.0 },
  { name: 'Motors', commission: 9.55 },
  { name: 'Media, Music & Books', commission: 14.8 },
  { name: 'Groceries', commission: 4.44 },
  { name: 'Computers & Laptops', commission: 8.6 },
  { name: 'Test Product (wont be seen in seller pls dont inactive)', commission: 3.65 },
  { name: "Kids' & Baby Fashion", commission: 2.95 },
  { name: 'Digital Goods', commission: 9.5 },
  { name: 'Watches Sunglasses Jewellery', commission: 20.0 },
  { name: 'Mother & Baby', commission: 10.14 },
  { name: 'Toys & Games', commission: 9.55 },
];

/** "Tools, DIY & Outdoor" and "Tools DIY and Outdoor" should be the same group. */
function key(name: string) {
  return name
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '');
}

const commissionByKey = new Map(DARAZ_LEVEL1_COMMISSION.map((c) => [key(c.name), c.commission]));

export function commissionFor(group: string): number | null {
  return commissionByKey.get(key(group)) ?? null;
}

export function groupOf(path: string) {
  return path.split(PATH_SEPARATOR)[0] || path;
}

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

/**
 * The Daraz price for a store price: the category's commission added on top, to the nearest rupee
 * (Rs 155 with 16% commission → Rs 180). An unknown or missing commission leaves the price as entered.
 */
export function addCommission(price: number, commissionPercent: number | null) {
  if (!Number.isFinite(price) || price <= 0) return 0;
  return Math.round(price * (1 + (commissionPercent ?? 0) / 100));
}
