import { describe, expect, it } from 'vitest';
import {
  DARAZ_LEVEL1_COMMISSION,
  grossUpPrice,
  commissionFor,
  filterLeaves,
  groupOf,
  groupsFromLeaves,
} from '../src/features/daraz/categoryGroups';

const leaves = [
  { id: 1, name: 'Earbuds', path: 'TV, Audio / Video, Gaming & Wearables › Audio › Earbuds' },
  { id: 2, name: 'Speakers', path: 'TV, Audio / Video, Gaming & Wearables › Audio › Speakers' },
  { id: 3, name: 'Smart Phones', path: 'Mobiles & Tablets › Smartphones' },
  { id: 4, name: 'Cases', path: 'Mobiles & Tablets › Accessories › Cases' },
];

describe('level-1 commission table', () => {
  it('has every category from the Daraz commission table once', () => {
    expect(DARAZ_LEVEL1_COMMISSION).toHaveLength(34);
    const names = DARAZ_LEVEL1_COMMISSION.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('looks up commission loosely by name', () => {
    expect(commissionFor('Mobiles & Tablets')).toBe(12.9);
    expect(commissionFor('mobiles and tablets')).toBe(12.9);
    expect(commissionFor('Tools DIY and Outdoor')).toBe(14.35);
    expect(commissionFor("Kids' & Baby Fashion")).toBe(2.95);
    expect(commissionFor('Charity and Donation')).toBe(0);
    expect(commissionFor('Not a real group')).toBeNull();
  });
});

describe('group helpers', () => {
  it('derives distinct sorted groups from breadcrumb paths', () => {
    expect(groupOf(leaves[0].path)).toBe('TV, Audio / Video, Gaming & Wearables');
    expect(groupsFromLeaves(leaves)).toEqual(['Mobiles & Tablets', 'TV, Audio / Video, Gaming & Wearables']);
  });

  it('lists a whole group when no query is typed, and narrows by every word', () => {
    expect(filterLeaves(leaves, 'Mobiles & Tablets', '').map((l) => l.id)).toEqual([3, 4]);
    expect(filterLeaves(leaves, 'Mobiles & Tablets', 'acc cases').map((l) => l.id)).toEqual([4]);
    expect(filterLeaves(leaves, '', 'audio').map((l) => l.id)).toEqual([1, 2]);
  });

  it('shows nothing until there is a group or a query, and caps the list', () => {
    expect(filterLeaves(leaves, '', '')).toEqual([]);
    expect(filterLeaves(leaves, 'Mobiles & Tablets', '', 1)).toHaveLength(1);
  });
});

describe('grossUpPrice', () => {
  it('prices so that what is left after the commission is the entered amount', () => {
    expect(grossUpPrice(8000, 14.8)).toBe(9390); // 9390 − 14.8% of 9390 = 8000.28
    expect(grossUpPrice(155, 16)).toBe(185);
    expect(grossUpPrice(1000, 0)).toBe(1000);
  });

  it('never leaves the seller short, and does not round an exact result up', () => {
    for (const [price, commission] of [[8000, 14.8], [1799, 12.9], [249, 8.6], [5000, 20]] as const) {
      const sellingPrice = grossUpPrice(price, commission);
      expect(sellingPrice - (sellingPrice * commission) / 100).toBeGreaterThanOrEqual(price - 1e-6);
    }
    expect(grossUpPrice(850, 15)).toBe(1000);
  });

  it('leaves the price alone when the commission is unknown, and ignores bad prices', () => {
    expect(grossUpPrice(155, null)).toBe(155);
    expect(grossUpPrice(155, 100)).toBe(155);
    expect(grossUpPrice(0, 16)).toBe(0);
    expect(grossUpPrice(Number.NaN, 16)).toBe(0);
  });
});
