import { describe, expect, it } from 'vitest';
import { buildPriceQuantityXml } from '../api/_lib/darazCore';
import { darazOfferFor, hasOffer } from '../src/features/daraz/darazOffer';

const leaves = [
  { id: 10, name: 'Sound Bars', path: 'TV, Audio / Video, Gaming & Wearables › Audio › Sound Bars' },
  { id: 20, name: 'Odd', path: 'Unlisted Group › Odd' },
];

describe('darazOfferFor', () => {
  it('grosses the rupee price up by the category commission (8.6% for audio) and rounds up', () => {
    const offer = darazOfferFor({ rupees: 8000, stock: undefined, categoryId: 10, leaves });
    expect(offer.price).toBe(Math.ceil(8000 / (1 - 0.086) - 1e-9));
    expect(offer.quantity).toBeUndefined();
  });

  it('uses the price as it is for a group with no known commission', () => {
    expect(darazOfferFor({ rupees: 500, categoryId: 20, leaves }).price).toBe(500);
  });

  it('sends the stock as the quantity, and nothing for untracked or invalid stock', () => {
    expect(darazOfferFor({ stock: 7, categoryId: 10, leaves })).toEqual({ quantity: 7 });
    expect(darazOfferFor({ stock: 0, categoryId: 10, leaves })).toEqual({ quantity: 0 });
    expect(hasOffer(darazOfferFor({ stock: null, categoryId: 10, leaves }))).toBe(false);
    expect(hasOffer(darazOfferFor({ stock: 1.5, categoryId: 10, leaves }))).toBe(false);
  });

  it('says so when the category cannot be found instead of guessing a price', () => {
    const offer = darazOfferFor({ rupees: 8000, stock: 3, categoryId: 99, leaves });
    expect(offer.price).toBeUndefined();
    expect(offer.quantity).toBe(3);
    expect(offer.note).toMatch(/category/);
    expect(darazOfferFor({ rupees: 8000, categoryId: 10, leaves: undefined }).note).toMatch(/category/);
  });
});

describe('buildPriceQuantityXml', () => {
  it('addresses the SKU by item and SKU id and includes only what changes', () => {
    const both = buildPriceQuantityXml({ itemId: '1', skuId: '2' }, { price: 9000, quantity: 4 });
    expect(both).toContain('<Sku><ItemId>1</ItemId><SkuId>2</SkuId><Price>9000</Price><Quantity>4</Quantity></Sku>');
    expect(both).not.toContain('SellerSku');
    const priceOnly = buildPriceQuantityXml({ itemId: '1', skuId: '2' }, { price: 9000 });
    expect(priceOnly).not.toContain('Quantity');
    expect(buildPriceQuantityXml({ itemId: '1', skuId: '2' }, { quantity: 0 })).toContain('<Quantity>0</Quantity>');
  });
});
