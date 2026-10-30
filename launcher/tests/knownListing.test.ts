import { describe, expect, it } from 'vitest';
import data from '../shared/audionicListing.json';
import { countWords } from '../shared/darazText';
import { knownListingFor, readKnownListing, type KnownListing } from '../shared/knownListing';
import { draftFromKnown } from '../api/_lib/listingAi';

const entries = Object.entries(data as Record<string, KnownListing>);
const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
const good: KnownListing = { description: words(40), highlights: ['One', 'Two', 'Three'], package: { weightKg: 1, lengthCm: 10, widthCm: 8, heightCm: 5 } };

describe('shared/audionicListing.json', () => {
  it('has one entry per in-stock product and every entry is complete and sensible', () => {
    expect(entries.length).toBe(81);
    for (const [id, entry] of entries) {
      expect(readKnownListing(entry), id).not.toBeNull();
      expect(countWords(entry.description), id).toBeGreaterThanOrEqual(32); // Daraz needs 30
      expect(entry.highlights.length, id).toBeGreaterThanOrEqual(3);
    }
  });

  it('never mentions the brand, which is the keyword Daraz may refuse', () => {
    expect(JSON.stringify(data).toLowerCase()).not.toContain('audionic');
  });

  it('is found by Audionic id, and only by that', () => {
    expect(knownListingFor('9362023874716')?.description).toMatch(/^Prism 600 is a 2\.1 channel sound bar/);
    expect(knownListingFor('nope')).toBeUndefined();
  });
});

describe('readKnownListing', () => {
  it('accepts a complete entry and trims the description', () => {
    expect(readKnownListing({ ...good, description: `  ${good.description}  ` })).toEqual(good);
  });

  it('rejects anything incomplete, too short, or out of range (it validates what a browser sends)', () => {
    expect(readKnownListing(null)).toBeNull();
    expect(readKnownListing('x')).toBeNull();
    expect(readKnownListing({ ...good, description: 'Too short.' })).toBeNull();
    expect(readKnownListing({ ...good, highlights: 'nope' })).toBeNull();
    expect(readKnownListing({ ...good, highlights: Array(7).fill('x') })).toBeNull();
    expect(readKnownListing({ ...good, package: { ...good.package, weightKg: 0 } })).toBeNull();
    expect(readKnownListing({ ...good, package: { ...good.package, lengthCm: 9999 } })).toBeNull();
    expect(readKnownListing({ ...good, package: { weightKg: '1' } })).toBeNull();
    expect(readKnownListing({ ...good, package: undefined })).toBeNull();
  });
});

describe('draftFromKnown', () => {
  it('uses the known text and package size and keeps only the AI\'s other fields', () => {
    const ai = { name: 'AI name', description: 'AI text', highlights: ['ai'], package: { weight: 9, length: 9, width: 9, height: 9 }, attributes: { warranty_type: 'Local Seller Warranty' } };
    expect(draftFromKnown(good, ai)).toEqual({
      name: '',
      description: good.description,
      highlights: good.highlights,
      package: { weight: 1, length: 10, width: 8, height: 5 },
      attributes: { warranty_type: 'Local Seller Warranty' },
    });
  });

  it('works without any AI answer', () => {
    expect(draftFromKnown(good, null).attributes).toEqual({});
  });
});
