import { describe, expect, it } from 'vitest';
import { htmlToText, normalizeDarazProducts, type DarazItem } from '../api/_lib/darazCore';
import { nameKey, planSync, removalsProblem, sourcesProblem, type StoreProduct } from '../api/_lib/reconcile';

const product = (id: string, name: string, stock: number | null = 5): StoreProduct => ({
  id,
  name,
  description: `${name} description`,
  price: 10,
  stock,
  brand: 'Brand',
  category: 'Audio',
  image: 'https://img/a.jpg',
  images: [],
});

const item = (itemId: string, name: string): DarazItem => ({
  itemId,
  skuId: `sku-${itemId}`,
  sellerSku: `SKU-${itemId}`,
  name,
  description: '<p>Nice</p>',
  brand: 'No Brand',
  categoryId: 10,
  price: 1000,
  quantity: 3,
  images: ['https://dz/a.jpg'],
});

const listing = (quantumProductId: string, darazItemId: string) => ({ quantumProductId, darazItemId, sellerSku: `SKU-${darazItemId}` });

describe('planSync', () => {
  it('leaves products that exist on both sides and are tracked alone', () => {
    const plan = planSync({ store: [product('p1', 'Speaker')], daraz: [item('d1', 'Speaker')], listings: [listing('p1', 'd1')] });
    expect(plan).toMatchObject({ link: [], importToStore: [], listOnDaraz: [], removeFromDaraz: [], removeFromStore: [], dropLinks: [] });
  });

  it('imports an untracked Daraz item and lists an untracked store product', () => {
    const plan = planSync({ store: [product('p1', 'Speaker')], daraz: [item('d1', 'Book')], listings: [] });
    expect(plan.importToStore.map((i) => i.itemId)).toEqual(['d1']);
    expect(plan.listOnDaraz.map((p) => p.id)).toEqual(['p1']);
  });

  it('only links the same product when both sides already have it (matched by name, ignoring case and punctuation)', () => {
    const plan = planSync({ store: [product('p1', 'Zia-ul Quran!')], daraz: [item('d1', 'zia ul quran')], listings: [] });
    expect(plan.link).toHaveLength(1);
    expect(plan.importToStore).toEqual([]);
    expect(plan.listOnDaraz).toEqual([]);
    expect(nameKey('Zia-ul Quran!')).toBe(nameKey('zia ul quran'));
  });

  it('matches one store product to one Daraz item only', () => {
    const plan = planSync({ store: [product('p1', 'Same')], daraz: [item('d1', 'Same'), item('d2', 'Same')], listings: [] });
    expect(plan.link).toHaveLength(1);
    expect(plan.importToStore).toHaveLength(1);
  });

  it('does not list sold-out store products on Daraz, but lists ones with untracked stock', () => {
    const plan = planSync({ store: [product('p1', 'Gone', 0), product('p2', 'Open', null)], daraz: [], listings: [] });
    expect(plan.listOnDaraz.map((p) => p.id)).toEqual(['p2']);
    expect(plan.soldOut).toBe(1);
  });

  it('marks a tracked product removed on one side for removal from the other', () => {
    const plan = planSync({
      store: [product('p1', 'Kept on store')],
      daraz: [item('d2', 'Kept on Daraz')],
      listings: [listing('p1', 'd1'), listing('p2', 'd2')],
    });
    expect(plan.removeFromStore.map((e) => e.product.id)).toEqual(['p1']);
    expect(plan.removeFromDaraz.map((e) => e.item.itemId)).toEqual(['d2']);
  });

  it('drops a tracking row when both sides are gone', () => {
    const plan = planSync({ store: [product('p9', 'Other')], daraz: [item('d9', 'Else')], listings: [listing('p1', 'd1')] });
    expect(plan.dropLinks).toHaveLength(1);
  });

  it('never touches products the Audionic page manages', () => {
    const plan = planSync({
      store: [product('a1', 'Audionic Buds', 0), product('a2', 'Audionic Bar')],
      daraz: [],
      listings: [listing('a3', 'd3')],
      managedProductIds: ['a1', 'a2', 'a3'],
    });
    expect(plan.listOnDaraz).toEqual([]);
    expect(plan.removeFromDaraz).toEqual([]);
    expect(plan.dropLinks).toEqual([]);
    expect(plan.managed).toBe(2);
  });

  it('treats a record without a store product id as untracked, so its Daraz item is imported instead of removed', () => {
    const plan = planSync({ store: [], daraz: [item('d1', 'Old listing')], listings: [{ quantumProductId: '', darazItemId: 'd1', sellerSku: 'S' }] });
    expect(plan.importToStore).toHaveLength(1);
    expect(plan.removeFromDaraz).toEqual([]);
  });
});

describe('safety checks', () => {
  it('refuses to trust an empty list while products are tracked', () => {
    expect(sourcesProblem({ store: 10, daraz: 0, listings: 4 })).toMatch(/Daraz returned no items/);
    expect(sourcesProblem({ store: 0, daraz: 10, listings: 4 })).toMatch(/QuantumStore returned no products/);
    expect(sourcesProblem({ store: 0, daraz: 0, listings: 0 })).toBeNull();
    expect(sourcesProblem({ store: 3, daraz: 3, listings: 2 })).toBeNull();
  });

  it('refuses removals when most tracked products seem to have vanished at once', () => {
    const many = planSync({
      store: [],
      daraz: ['1', '2', '3', '4'].map((n) => item(`d${n}`, `x${n}`)),
      listings: ['1', '2', '3', '4'].map((n) => listing(`p${n}`, `d${n}`)),
    });
    expect(removalsProblem(many, 4)).toMatch(/too many/);
    const few = planSync({ store: [product('p1', 'a')], daraz: [], listings: [listing('p1', 'd1'), listing('p2', 'd2'), listing('p3', 'd3'), listing('p4', 'd4')] });
    expect(few.dropLinks.length + few.removeFromStore.length).toBeGreaterThan(0);
    expect(removalsProblem({ ...few, removeFromStore: few.removeFromStore }, 40)).toBeNull();
  });
});

describe('normalizeDarazProducts / htmlToText', () => {
  it('reads GetProducts rows and skips deleted or SKU-less items', () => {
    const items = normalizeDarazProducts([
      {
        item_id: 111,
        primary_category: 9718,
        attributes: { name: ' Sound Bar ', brand: 'Audionic', description: '<p>Loud &amp; clear</p>' },
        skus: [{ SkuId: 5, SellerSku: 'AUD-1', price: '19585', quantity: 10, Images: ['https://dz/1.jpg', 'https://dz/2.jpg', ''] }],
      },
      { item_id: 222, skus: [{ SkuId: 6, Status: 'deleted' }] },
      { item_id: 333, skus: [] },
    ]);
    expect(items).toEqual([
      {
        itemId: '111',
        skuId: '5',
        sellerSku: 'AUD-1',
        name: 'Sound Bar',
        description: '<p>Loud &amp; clear</p>',
        brand: 'Audionic',
        categoryId: 9718,
        price: 19585,
        quantity: 10,
        images: ['https://dz/1.jpg', 'https://dz/2.jpg'],
      },
    ]);
    expect(normalizeDarazProducts(undefined)).toEqual([]);
  });

  it('turns Daraz HTML into plain text', () => {
    expect(htmlToText('<p>Loud &amp; clear</p><ul><li>One</li><li>Two&nbsp;now</li></ul>')).toBe('Loud & clear\nOne\nTwo now');
  });
});
