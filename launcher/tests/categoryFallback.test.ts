import { describe, expect, it } from 'vitest';
import { fallbackCategory } from '../src/features/audionic/categoryFallback';

const AUDIO = 'TV, Audio / Video, Gaming & Wearables';
const leaves = [
  { id: 1, name: 'Starters', path: 'Motors › Automotive › Batteries & Accessories › Starters' },
  { id: 2, name: 'Home Speakers', path: `${AUDIO} › Audio › Speakers › Home Speakers` },
  { id: 3, name: 'Bluetooth Speakers', path: `${AUDIO} › Audio › Speakers › Bluetooth Speakers` },
  { id: 4, name: 'Wireless Earbuds', path: `${AUDIO} › Audio › Headphones & Headsets › Wireless Earbuds` },
  { id: 5, name: 'Power Banks', path: 'Mobiles & Tablets › Mobile Accessories › Power Banks' },
];

describe('fallbackCategory', () => {
  it('picks the preferred category for a type without the AI', () => {
    expect(fallbackCategory('Speakers', leaves)?.id).toBe(3);
    expect(fallbackCategory('Earbuds', leaves)?.id).toBe(4);
    expect(fallbackCategory('Power Banks', leaves)?.id).toBe(5);
  });

  it('falls back to a broader word when the preferred category does not exist', () => {
    expect(fallbackCategory('Speakers', leaves.filter((l) => l.id !== 3))?.id).toBe(2);
  });

  it('returns null for a type with no rule or no match', () => {
    expect(fallbackCategory('Accessories', leaves)).toBeNull();
    expect(fallbackCategory('Headphones', leaves)).toBeNull();
  });
});
