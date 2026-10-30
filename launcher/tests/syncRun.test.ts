import { describe, expect, it, vi } from 'vitest';
import type { DarazItem } from '../api/_lib/darazCore';
import { HttpError } from '../api/_lib/http';
import type { StoreProduct } from '../api/_lib/reconcile';
import {
  DEFAULT_DARAZ_QUANTITY,
  previewSync,
  runSync,
  sellerSkuFor,
  storePayloadFromDaraz,
  type StoredListing,
  type SyncDeps,
} from '../api/_lib/syncRun';
import { grossUpPrice } from '../shared/commission';
import { rupeesToStored } from '../shared/pricing';

const LEAVES = [{ id: 10, name: 'Sound Bars', path: 'TV, Audio / Video, Gaming & Wearables › Audio › Sound Bars' }];
const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

const product = (id: string, name: string, extra: Partial<StoreProduct> = {}): StoreProduct => ({
  id,
  name,
  description: words(40),
  price: rupeesToStored(8000, 278),
  stock: 4,
  brand: 'Acme',
  category: 'Audio',
  image: 'https://drive/a.jpg',
  images: ['https://drive/b.jpg'],
  ...extra,
});

const item = (itemId: string, name: string, extra: Partial<DarazItem> = {}): DarazItem => ({
  itemId,
  skuId: `sku-${itemId}`,
  sellerSku: `SKU-${itemId}`,
  name,
  description: `<p>${words(20)}</p>`,
  brand: 'No Brand',
  categoryId: 10,
  price: 8750,
  quantity: 7,
  images: ['https://dz/1.jpg', 'https://dz/2.jpg'],
  ...extra,
});

function makeDeps(state: { store: StoreProduct[]; daraz: DarazItem[]; listings: StoredListing[]; managed?: string[] }) {
  const log = vi.fn();
  const deps: SyncDeps = {
    store: {
      products: async () => state.store,
      rate: async () => 278,
      ensureCategory: vi.fn(async (name: string) => name),
      createProduct: vi.fn(async () => ({ _id: 'new-1' })),
      deleteProduct: vi.fn(async () => {}),
    },
    daraz: {
      items: async () => state.daraz,
      leaves: async () => LEAVES,
      removeItem: vi.fn(async () => {}),
      prepare: vi.fn(async () => ({
        category: { id: 10, path: LEAVES[0].path },
        attributes: { warranty_type: 'No Warranty' },
        package: { weight: 2, length: 40, width: 20, height: 10 },
        description: '',
        missing: [],
      })),
      publish: vi.fn(async () => ({ itemId: 'item-new' })),
    },
    listings: {
      all: async () => state.listings,
      save: vi.fn(async () => {}),
      removeByItem: vi.fn(async () => {}),
    },
    managedProductIds: async () => state.managed ?? [],
    log,
  };
  return { deps, log };
}

const listing = (quantumProductId: string, darazItemId: string): StoredListing => ({
  quantumProductId,
  darazItemId,
  sellerSku: `SKU-${darazItemId}`,
  skuId: `sku-${darazItemId}`,
  categoryId: 10,
});

describe('runSync: imports and listings', () => {
  it('creates a Daraz-only item on QuantumStore at the price the seller keeps, and tracks it', async () => {
    const { deps } = makeDeps({ store: [product('p0', 'Existing')], daraz: [item('d1', 'Soundbar X')], listings: [listing('p0', 'd0')] });
    // d0 is gone from Daraz and p0 still exists → only a pending removal, no side effects besides the import
    const report = await runSync(deps, { applyRemovals: false });
    expect(report.imported).toEqual(['Soundbar X']);
    const payload = (deps.store.createProduct as any).mock.calls[0][0];
    // Daraz 8750 with 8.6% commission → seller keeps round(8750 × 0.914) = 7998
    expect(payload).toMatchObject({ name: 'Soundbar X', category: 'Audio', stock: 7, brand: 'Generic', image: 'https://dz/1.jpg', images: ['https://dz/2.jpg'] });
    expect(payload.price).toBe(rupeesToStored(Math.round(8750 * 0.914), 278));
    expect(deps.listings.save).toHaveBeenCalledWith(expect.objectContaining({ quantumProductId: 'new-1', darazItemId: 'd1', skuId: 'sku-d1' }));
  });

  it('lists a store-only product on Daraz with the commission added and a unique SKU', async () => {
    const p = product('abc123def', 'Smart Speaker 5');
    const { deps } = makeDeps({ store: [p], daraz: [], listings: [] });
    const report = await runSync(deps, { applyRemovals: false });
    expect(report.listed).toEqual(['Smart Speaker 5']);
    const request = (deps.daraz.publish as any).mock.calls[0][0];
    expect(request).toMatchObject({
      quantumProductId: 'abc123def',
      categoryId: 10,
      quantity: 4,
      sellerSku: sellerSkuFor(p),
      images: ['https://drive/a.jpg', 'https://drive/b.jpg'],
    });
    expect(request.price).toBe(grossUpPrice(8000, 8.6));
    expect(sellerSkuFor(p)).toBe('SMART-SPEAKER-5-123DEF');
  });

  it('uses the default quantity when store stock is untracked, and skips sold-out products', async () => {
    const { deps } = makeDeps({ store: [product('p1', 'Open', { stock: null }), product('p2', 'Gone', { stock: 0 })], daraz: [], listings: [] });
    const report = await runSync(deps, { applyRemovals: false });
    expect((deps.daraz.publish as any).mock.calls).toHaveLength(1);
    expect((deps.daraz.publish as any).mock.calls[0][0].quantity).toBe(DEFAULT_DARAZ_QUANTITY);
    expect(report.skipped.soldOut).toBe(1);
  });

  it('reports why a product could not be listed instead of failing the whole run', async () => {
    const { deps } = makeDeps({ store: [product('p1', 'No category'), product('p2', 'Fine')], daraz: [], listings: [] });
    (deps.daraz.prepare as any).mockResolvedValueOnce({ category: null, attributes: {}, package: null, missing: [] });
    const report = await runSync(deps, { applyRemovals: false });
    expect(report.listed).toEqual(['Fine']);
    expect(report.failures).toEqual([expect.objectContaining({ name: 'No category', reason: expect.stringMatching(/category/) })]);
  });

  it('does not list products whose images are not public https links', async () => {
    const { deps } = makeDeps({ store: [product('p1', 'Local', { image: '/uploads/a.webp', images: [] })], daraz: [], listings: [] });
    const report = await runSync(deps, { applyRemovals: false });
    expect(deps.daraz.publish).not.toHaveBeenCalled();
    expect(report.failures[0].reason).toMatch(/https/);
  });

  it('only links a product that is already on both sides', async () => {
    const { deps } = makeDeps({ store: [product('p1', 'Same Thing')], daraz: [item('d1', 'same thing')], listings: [] });
    const report = await runSync(deps, { applyRemovals: false });
    expect(report.linked).toEqual(['Same Thing']);
    expect(deps.store.createProduct).not.toHaveBeenCalled();
    expect(deps.daraz.publish).not.toHaveBeenCalled();
    expect(deps.listings.save).toHaveBeenCalledWith(expect.objectContaining({ quantumProductId: 'p1', darazItemId: 'd1' }));
  });

  it('carries on after one failure and stops entirely on a sign-in or rate-limit error', async () => {
    const { deps } = makeDeps({ store: [], daraz: [item('d1', 'A'), item('d2', 'B')], listings: [] });
    (deps.store.createProduct as any).mockRejectedValueOnce(new HttpError(502, 'QuantumStore: HTTP 500'));
    const report = await runSync(deps, { applyRemovals: false });
    expect(report.imported).toEqual(['B']);
    expect(report.failures).toHaveLength(1);

    const second = makeDeps({ store: [], daraz: [item('d1', 'A'), item('d2', 'B')], listings: [] });
    (second.deps.store.createProduct as any).mockRejectedValue(new HttpError(429, 'QuantumStore: too many requests'));
    await expect(runSync(second.deps, { applyRemovals: false })).rejects.toThrow(/too many/);
    expect((second.deps.store.createProduct as any).mock.calls).toHaveLength(1);
  });
});

describe('runSync: removals', () => {
  const state = () => ({
    store: [product('p1', 'Only on store'), product('p3', 'Both')],
    daraz: [item('d2', 'Only on Daraz'), item('d3', 'Both')],
    listings: [listing('p1', 'd1'), listing('p2', 'd2'), listing('p3', 'd3'), listing('p4', 'd4'), listing('p5', 'd5'), listing('p6', 'd6'), listing('p7', 'd7'), listing('p8', 'd8')],
  });

  it('only previews removals unless they are switched on', async () => {
    const { deps } = makeDeps(state());
    const report = await runSync(deps, { applyRemovals: false });
    expect(deps.daraz.removeItem).not.toHaveBeenCalled();
    expect(deps.store.deleteProduct).not.toHaveBeenCalled();
    expect(report.pendingRemovals).toEqual({ fromDaraz: ['Only on Daraz'], fromStore: ['Only on store'] });
    expect(report.droppedLinks).toBe(5);
  });

  it('removes from the other side when switched on, and forgets the tracking row', async () => {
    const { deps } = makeDeps(state());
    const report = await runSync(deps, { applyRemovals: true });
    expect(deps.daraz.removeItem).toHaveBeenCalledWith(expect.objectContaining({ itemId: 'd2', skuId: 'sku-d2' }));
    expect(deps.store.deleteProduct).toHaveBeenCalledWith('p1');
    expect(deps.listings.removeByItem).toHaveBeenCalledWith('d2');
    expect(deps.listings.removeByItem).toHaveBeenCalledWith('d1');
    expect(report.removedFromDaraz).toEqual(['Only on Daraz']);
    expect(report.removedFromStore).toEqual(['Only on store']);
  });

  it('keeps the tracking row when the other side refuses the removal', async () => {
    const { deps } = makeDeps(state());
    (deps.daraz.removeItem as any).mockRejectedValue(new Error('Daraz refused'));
    const report = await runSync(deps, { applyRemovals: true });
    expect(report.failures).toEqual([expect.objectContaining({ action: 'Remove from Daraz', reason: 'Daraz refused' })]);
    expect(deps.listings.removeByItem).not.toHaveBeenCalledWith('d2');
  });

  it('refuses to remove when nearly everything looks deleted at once', async () => {
    const { deps } = makeDeps({
      store: [product('p9', 'Unrelated')],
      daraz: [item('d1', 'a'), item('d2', 'b'), item('d3', 'c')],
      listings: [listing('p1', 'd1'), listing('p2', 'd2'), listing('p3', 'd3')],
    });
    const report = await runSync(deps, { applyRemovals: true });
    expect(deps.daraz.removeItem).not.toHaveBeenCalled();
    expect(report.pendingRemovals.blocked).toMatch(/too many/);
  });

  it('stops before doing anything when Daraz answers with nothing', async () => {
    const { deps } = makeDeps({ store: [product('p1', 'A')], daraz: [], listings: [listing('p1', 'd1')] });
    const report = await runSync(deps, { applyRemovals: true });
    expect(report.problem).toMatch(/Daraz returned no items/);
    expect(deps.store.deleteProduct).not.toHaveBeenCalled();
    expect(deps.daraz.publish).not.toHaveBeenCalled();
  });

  it('leaves Audionic products to the Audionic page', async () => {
    const { deps } = makeDeps({
      store: [product('a1', 'Audionic Bar'), product('p1', 'Mine')],
      daraz: [item('d1', 'Mine')],
      listings: [listing('a1', 'dA'), listing('p1', 'd1')],
      managed: ['a1'],
    });
    const report = await runSync(deps, { applyRemovals: true });
    expect(deps.store.deleteProduct).not.toHaveBeenCalled();
    expect(report.skipped.managed).toBe(1);
  });
});

describe('previewSync / storePayloadFromDaraz', () => {
  it('names what a run would do without doing it', async () => {
    const { deps } = makeDeps({ store: [product('p1', 'Store only')], daraz: [item('d1', 'Daraz only')], listings: [] });
    const preview = await previewSync(deps);
    expect(preview).toMatchObject({ importToStore: ['Daraz only'], listOnDaraz: ['Store only'], removeFromDaraz: [], removeFromStore: [] });
    expect(deps.store.createProduct).not.toHaveBeenCalled();
  });

  it('pads a too-short Daraz description and keeps a real brand', () => {
    const payload = storePayloadFromDaraz(item('d1', 'Tiny', { description: '<b>x</b>', brand: 'Audionic' }), 278, LEAVES, 'Audio');
    expect(payload.description).toBe('Tiny — imported from Daraz');
    expect(payload.brand).toBe('Audionic');
  });
});
