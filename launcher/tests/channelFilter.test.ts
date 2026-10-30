import { describe, expect, it } from 'vitest';
import { chipCounts, matchesChannel, matchesStock } from '../src/features/products/channelFilter';

const listed = new Set(['a', 'b']);
const products = [
  { _id: 'a', stock: 5 },
  { _id: 'b', stock: 0 },
  { _id: 'c', stock: null },
  { _id: 'd', stock: 0 },
];

describe('matchesChannel', () => {
  it('separates products on Daraz from those only on QuantumStore', () => {
    expect(matchesChannel('a', 'daraz', listed)).toBe(true);
    expect(matchesChannel('c', 'daraz', listed)).toBe(false);
    expect(matchesChannel('a', 'store', listed)).toBe(false);
    expect(matchesChannel('c', 'store', listed)).toBe(true);
    expect(matchesChannel('c', 'all', listed)).toBe(true);
  });
});

describe('matchesStock', () => {
  it('counts untracked stock as in stock, like the backend', () => {
    expect(matchesStock(null, 'in')).toBe(true);
    expect(matchesStock(undefined, 'out')).toBe(false);
    expect(matchesStock(0, 'out')).toBe(true);
    expect(matchesStock(0, 'in')).toBe(false);
    expect(matchesStock(3, 'all')).toBe(true);
  });
});

describe('chipCounts', () => {
  it('counts everything when nothing is chosen', () => {
    expect(chipCounts(products, listed, { channel: 'all', stock: 'all' })).toEqual({
      stock: { all: 4, in: 2, out: 2 },
      channel: { all: 4, daraz: 2, store: 2 },
    });
  });

  it('makes each row follow the choice in the other row', () => {
    const counts = chipCounts(products, listed, { channel: 'daraz', stock: 'out' });
    expect(counts.stock).toEqual({ all: 2, in: 1, out: 1 });
    expect(counts.channel).toEqual({ all: 2, daraz: 1, store: 1 });
  });
});
