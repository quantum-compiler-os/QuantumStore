import { describe, expect, it } from 'vitest';
import { finderMessages, isMarketplace, knownShops, readFinderAnswer } from '../api/_lib/storeFinder';
import { ownPageReason, storeOrigin } from '../api/_lib/storeFetcher';

describe("the AI's list of shops", () => {
  it('becomes unique shop hosts, whatever form the domains come in', () => {
    const shops = readFinderAnswer({
      shops: [
        { domain: 'https://www.Gadgets.pk/collections/all', name: 'Gadgets', sells: 'phone accessories' },
        { domain: 'gadgets.pk', name: 'Gadgets again' },
        'books-corner.com.pk',
        { domain: 'kitchen.pk.', name: '  Kitchen Hub  ', sells: 'cookware' },
      ],
    });
    expect(shops).toEqual([
      { host: 'gadgets.pk', name: 'Gadgets', sells: 'phone accessories' },
      { host: 'books-corner.com.pk', name: 'books-corner.com.pk', sells: '' },
      { host: 'kitchen.pk', name: 'Kitchen Hub', sells: 'cookware' },
    ]);
  });

  it('leaves out marketplaces, our own pages, shops already known and things that are not addresses', () => {
    const shops = readFinderAnswer(
      {
        shops: [
          { domain: 'daraz.pk' },
          { domain: 'www.olx.com.pk' },
          { domain: 'some-shop.myshopify.com' },
          { domain: 'audionic.co' },
          { domain: 'store.quantumlogicslimited.com' },
          { domain: 'localhost' },
          { domain: 'not a domain' },
          { domain: 42 },
          { domain: 'synced-before.pk' },
          { domain: 'fresh.pk' },
        ],
      },
      ['www.synced-before.pk'],
    );
    expect(shops.map((s) => s.host)).toEqual(['fresh.pk']);
    expect(isMarketplace('pk.aliexpress.com')).toBe(true);
  });

  it('is empty when the AI answers something else', () => {
    expect(readFinderAnswer(null)).toEqual([]);
    expect(readFinderAnswer({ stores: ['a.pk'] })).toEqual([]);
  });

  it('asks for Pakistani shops that sell what was typed, leaving out the known ones', () => {
    const [, user] = finderMessages('mobile accessories', 15, ['gadgets.pk']);
    expect(user.content).toMatch(/up to 15 online shops based in Pakistan that sell mobile accessories/);
    expect(user.content).toMatch(/Leave out these, already known: gadgets\.pk/);
    expect(finderMessages('', 10, [])[1].content).toMatch(/sell anything/);
  });
});

describe('known shops', () => {
  it('fit what was typed: the shops matching the most words', () => {
    const hosts = (focus: string) => knownShops(focus).map((s) => s.host);
    expect(hosts('mobile accessories')).toContain('baseus.pk');
    expect(hosts('mobile accessories')).not.toContain('outfitters.com.pk');
    expect(hosts('clothes')).toContain('outfitters.com.pk');
    expect(hosts('clothes')).not.toContain('baseus.pk');
    expect(hosts('kitchen items')).toContain('homeessentials.pk');
    expect(hosts('books')).toEqual([]);
  });

  it('are all offered when nothing was typed, except shops already known', () => {
    const all = knownShops('');
    expect(all.length).toBeGreaterThan(20);
    expect(knownShops('', ['www.baseus.pk']).map((s) => s.host)).not.toContain('baseus.pk');
    // Every known shop passes the same address checks as a typed one.
    for (const shop of all) expect(() => storeOrigin(shop.host)).not.toThrow();
  });
});

describe('shops with their own page', () => {
  it('are refused by the Store fetcher, so their products are not listed twice', () => {
    expect(() => storeOrigin('https://www.audionic.co')).toThrow(/own page \(Audionic\)/);
    expect(() => storeOrigin('camsham.pk')).toThrow(/own page \(CamSham\)/);
    expect(() => storeOrigin('pakbooks.com')).toThrow(/own page \(PakBooks\)/);
    expect(ownPageReason('store.quantumlogicslimited.com')).toMatch(/our own shop/);
    expect(ownPageReason('notaudionic.co')).toBeNull();
  });
});
