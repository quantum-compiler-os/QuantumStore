import { describe, expect, it, vi } from 'vitest';
import { toItem, type ShopifyProduct } from '../api/_lib/audionic';
import type { AudionicLinkRow } from '../src/api/audionic';
import { grossUpPrice } from '../src/features/daraz/categoryGroups';
import {
  DARAZ_QUANTITY,
  PAUSE_DARAZ_AFTER_BLOCKS,
  STOP_AFTER_FAILURES,
  consecutiveBlocked,
  adoptedLinks,
  consecutiveFailures,
  itemStatus,
  markSoldOut,
  refreshPayload,
  removedLinks,
  sellerSkuFor,
  storePayload,
  syncItem,
  type SyncDeps,
} from '../src/features/audionic/syncOne';
import { storedToRupees } from '../src/features/products/pricing';

const RATE = 278;
/** What the AI returns for the description: Daraz needs at least 30 words. */
const AI_DESCRIPTION = Array.from({ length: 40 }, (_, i) => `feature${i}`).join(' ');
const NO_AI_TEXT = {
  category: null,
  attributes: {},
  package: { weight: 0.2, length: 10, width: 8, height: 4 },
  description: '',
  missing: [],
};
const AUDIO_CATEGORY = { id: 77, path: 'TV, Audio / Video, Gaming & Wearables › Audio › Earbuds' }; // 8.6% commission

const earbuds: ShopifyProduct = {
  id: 101,
  title: 'Airbud Test Earbuds',
  handle: 'airbud-test',
  product_type: 'Wireless Earbuds',
  published_at: null,
  body_html: '',
  variants: [
    { title: 'Black', price: '3499.00', available: true },
    { title: 'White', price: '3499.00', available: false },
  ],
  images: [{ src: 'https://cdn.shopify.com/s/files/1/a.webp?v=1' }, { src: 'https://cdn.shopify.com/s/files/1/b.webp?v=1' }],
};
const kind = { type: 'Earbuds', category: 'Audio' };
const item = toItem(earbuds, kind)!;
const soldOut = toItem({ ...earbuds, id: 102, variants: [{ title: 'Default Title', price: '2000', available: false }] }, kind)!;

function deps(overrides: Partial<SyncDeps> = {}): SyncDeps {
  return {
    rate: RATE,
    daraz: { ready: true, category: AUDIO_CATEGORY },
    ensureCategory: vi.fn(async (name: string) => name),
    createProduct: vi.fn(async () => ({ _id: 'prod-1' })),
    updateProduct: vi.fn(async () => true),
    prepareDaraz: vi.fn(async () => ({
      category: null,
      attributes: { age_group: 'Adults' },
      package: { weight: 0.2, length: 10, width: 8, height: 4 },
      description: AI_DESCRIPTION,
      missing: [],
    })),
    publishDaraz: vi.fn(async () => ({ itemId: '9001', skuId: '1', sellerSku: 'AUD-101' })),
    saveLink: vi.fn(async () => undefined),
    ...overrides,
  };
}

const link = (over: Partial<AudionicLinkRow> = {}): AudionicLinkRow => ({
  audionicId: '101',
  quantumProductId: 'prod-1',
  darazItemId: '9001',
  sellerSku: 'AUD-101',
  sourcePkr: 3499,
  available: true,
  ...over,
});

describe('prices', () => {
  it('stores Audionic\'s price exactly, with no Rs 100 deduction', () => {
    const payload = storePayload(item, RATE, 'Audio');
    expect(storedToRupees(payload.price, RATE)).toBe(3499);
    expect(payload.variants.map((v) => [v.label, storedToRupees(v.price, RATE), v.stock])).toEqual([
      ['Black', 3499, null],
      ['White', 3499, 0],
    ]);
    expect(payload).toMatchObject({ brand: 'Audionic', category: 'Audio', stock: null, thumbnail: item.thumbnail });
  });

  it('marks an item with nothing available as sold out', () => {
    expect(storePayload(soldOut, RATE, 'Audio').stock).toBe(0);
  });

  it('refreshes only price, availability, variants and pictures on an existing product', () => {
    expect(Object.keys(refreshPayload(item, RATE)).sort()).toEqual(['image', 'images', 'price', 'stock', 'thumbnail', 'variants']);
  });
});

describe('syncItem: a new item', () => {
  it('creates it on QuantumStore and on Daraz, with the commission formula on the Daraz price', async () => {
    const d = deps();
    const result = await syncItem(item, undefined, d);

    expect(result).toMatchObject({ store: 'created', daraz: 'listed', darazMessage: 'Item 9001' });
    expect(d.ensureCategory).toHaveBeenCalledWith('Audio');
    const created = (d.createProduct as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(storedToRupees(created.price, RATE)).toBe(3499);

    const request = (d.publishDaraz as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // 3499 ÷ (1 − 8.6%) = 3828.2 → 3829: after Daraz keeps its commission, at least Rs 3,499 is left.
    expect(request.price).toBe(grossUpPrice(3499, 8.6));
    expect(request.price).toBe(3829);
    expect(request).toMatchObject({
      quantumProductId: 'prod-1',
      categoryId: 77,
      sellerSku: 'AUD-101',
      quantity: DARAZ_QUANTITY,
      brand: 'Audionic',
      images: item.darazImages,
      package: { weight: 0.2, length: 10, width: 8, height: 4, content: item.name },
      attributes: { age_group: 'Adults' },
    });
    expect(DARAZ_QUANTITY).toBe(10);
  });

  it('remembers the link on both steps, and the Daraz item once it exists', async () => {
    const d = deps();
    await syncItem(item, undefined, d);
    const saved = (d.saveLink as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(saved[0]).toMatchObject({ audionicId: '101', quantumProductId: 'prod-1', darazItemId: null, sourcePkr: 3499, available: true });
    expect(saved[1]).toMatchObject({ darazItemId: '9001', sellerSku: 'AUD-101' });
  });

  it('reports QuantumStore first and Daraz right after, one product at a time', async () => {
    const stages: string[] = [];
    const d = deps({ onStage: (s) => stages.push(s) });
    await syncItem(item, undefined, d);
    expect(stages).toEqual(['store', 'daraz']);
  });

  it('keeps a sold-out item on QuantumStore only', async () => {
    const d = deps();
    const result = await syncItem(soldOut, undefined, d);
    expect(result).toMatchObject({ store: 'created', daraz: 'skipped', darazMessage: 'Sold out on Audionic' });
    expect(d.publishDaraz).not.toHaveBeenCalled();
  });

  it('skips Daraz without a connection or a chosen category, still creating the store product', async () => {
    const offline = deps({ daraz: { ready: false, category: AUDIO_CATEGORY } });
    expect(await syncItem(item, undefined, offline)).toMatchObject({ store: 'created', daraz: 'skipped', darazMessage: 'Daraz is not connected' });

    const noCategory = deps({ daraz: { ready: true, category: null } });
    expect(await syncItem(item, undefined, noCategory)).toMatchObject({ store: 'created', daraz: 'skipped', darazMessage: 'Choose a Daraz category for Earbuds' });
    expect(noCategory.publishDaraz).not.toHaveBeenCalled();
  });

  it('keeps the store product when Daraz refuses, and leaves the link ready for a retry', async () => {
    const d = deps({ publishDaraz: vi.fn(async () => Promise.reject(new Error('Daraz says no'))) });
    const result = await syncItem(item, undefined, d);
    expect(result).toMatchObject({ store: 'created', daraz: 'failed', darazMessage: 'Daraz says no' });
    const saved = (d.saveLink as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(saved).toHaveLength(1);
    expect(saved[0].darazItemId).toBeNull();
  });

  it('does not send an incomplete listing to Daraz when the package size is unknown', async () => {
    const d = deps({
      prepareDaraz: vi.fn(async () => ({ category: null, attributes: {}, package: null, missing: [] })),
    });
    const result = await syncItem(item, undefined, d);
    expect(result.daraz).toBe('failed');
    expect(result.darazMessage).toMatch(/package weight/);
    expect(d.publishDaraz).not.toHaveBeenCalled();
  });

  it('stops before Daraz when QuantumStore fails, and saves nothing', async () => {
    const d = deps({ createProduct: vi.fn(async () => Promise.reject(new Error('backend down'))) });
    const result = await syncItem(item, undefined, d);
    expect(result).toMatchObject({ store: 'failed', daraz: 'skipped', storeMessage: 'backend down' });
    expect(d.publishDaraz).not.toHaveBeenCalled();
    expect(d.saveLink).not.toHaveBeenCalled();
  });

  it('warns loudly when the product was created but the link could not be saved', async () => {
    const d = deps({ saveLink: vi.fn(async () => Promise.reject(new Error('mongo down'))) });
    const result = await syncItem(item, undefined, d);
    expect(result.store).toBe('created');
    expect(result.storeMessage).toMatch(/would duplicate it.*mongo down/);
  });
});

describe('syncItem: an item synced before', () => {
  it('refreshes the store price when Audionic changed it, and leaves Daraz alone', async () => {
    const d = deps();
    const repriced = { ...item, pkr: 3999 };
    const result = await syncItem(repriced, link(), d);
    expect(result).toMatchObject({ store: 'refreshed', daraz: 'unchanged' });
    const [id, payload] = (d.updateProduct as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(id).toBe('prod-1');
    expect(storedToRupees(payload.price, RATE)).toBe(3999);
    expect(d.createProduct).not.toHaveBeenCalled();
    expect(d.publishDaraz).not.toHaveBeenCalled();
  });

  it('does nothing when neither price nor availability changed', async () => {
    const d = deps();
    expect(await syncItem(item, link(), d)).toEqual({ store: 'unchanged', daraz: 'unchanged' });
    expect(d.updateProduct).not.toHaveBeenCalled();
    expect(d.saveLink).not.toHaveBeenCalled();
  });

  it('creates the product again when it was deleted on QuantumStore', async () => {
    const d = deps({ updateProduct: vi.fn(async () => false), createProduct: vi.fn(async () => ({ _id: 'prod-2' })) });
    const result = await syncItem({ ...item, pkr: 4100 }, link(), d);
    expect(result.store).toBe('created');
    expect((d.saveLink as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ quantumProductId: 'prod-2', sourcePkr: 4100 });
  });

  it('lists a store-only item on Daraz later without touching QuantumStore', async () => {
    const d = deps();
    const result = await syncItem(item, link({ darazItemId: null }), d);
    expect(result).toMatchObject({ store: 'unchanged', daraz: 'listed' });
    expect(d.updateProduct).not.toHaveBeenCalled();
    expect(d.createProduct).not.toHaveBeenCalled();
    expect((d.publishDaraz as ReturnType<typeof vi.fn>).mock.calls[0][0].quantumProductId).toBe('prod-1');
    expect((d.saveLink as ReturnType<typeof vi.fn>).mock.calls[0][0].darazItemId).toBe('9001');
  });
});

describe('what a run would do', () => {
  const ready = { darazReady: true, hasCategory: true };

  it('tells new, changed, Daraz-missing and synced items apart', () => {
    expect(itemStatus(item, undefined, ready)).toBe('new');
    expect(itemStatus({ ...item, pkr: 1 }, link(), ready)).toBe('changed');
    expect(itemStatus({ ...item, available: false }, link(), ready)).toBe('changed');
    expect(itemStatus(item, link({ darazItemId: null }), ready)).toBe('daraz-missing');
    expect(itemStatus(item, link(), ready)).toBe('synced');
  });

  it('does not call a store-only item "Daraz missing" when Daraz cannot take it anyway', () => {
    expect(itemStatus(item, link({ darazItemId: null }), { darazReady: false, hasCategory: true })).toBe('synced');
    expect(itemStatus(item, link({ darazItemId: null }), { darazReady: true, hasCategory: false })).toBe('synced');
    expect(itemStatus(soldOut, link({ audionicId: '102', darazItemId: null, sourcePkr: 2000, available: false }), ready)).toBe('synced');
  });

  it('finds synced products Audionic no longer lists, marks them sold out, and stops offering them', async () => {
    const gone = link({ audionicId: '555', quantumProductId: 'prod-9' });
    const alreadyHandled = link({ audionicId: '556', quantumProductId: 'prod-10', available: false });
    expect(removedLinks([item], [link(), gone, alreadyHandled])).toEqual([gone]);

    const setStock = vi.fn(async () => undefined);
    const saveLink = vi.fn(async () => undefined);
    await markSoldOut(gone, setStock, saveLink);
    expect(setStock).toHaveBeenCalledWith('prod-9', 0);
    expect(saveLink).toHaveBeenCalledWith({ ...gone, available: false });
    expect(removedLinks([item], [{ ...gone, available: false }])).toEqual([]);
  });

  it('uses the same SKU for the same Audionic product', () => {
    expect(sellerSkuFor('101')).toBe('AUD-101');
  });
});

describe('stopping a long run that keeps failing', () => {
  const ok = { store: 'created', daraz: 'listed' } as const;
  const darazFailed = { store: 'created', daraz: 'failed', darazMessage: 'no' } as const;
  const storeFailed = { store: 'failed', daraz: 'skipped', storeMessage: 'down' } as const;
  const soldOutResult = { store: 'created', daraz: 'skipped' } as const;

  it('counts failures in a row on one step and starts again after a success', () => {
    let count = 0;
    for (let i = 0; i < 2; i++) count = consecutiveFailures(count, darazFailed, 'daraz');
    expect(count).toBe(2);
    count = consecutiveFailures(count, ok, 'daraz');
    expect(count).toBe(0);
  });

  it('is not reset by products that never reached the step (sold out, Daraz off)', () => {
    let count = consecutiveFailures(0, darazFailed, 'daraz');
    count = consecutiveFailures(count, soldOutResult, 'daraz');
    expect(count).toBe(1);
    count = consecutiveFailures(count, darazFailed, 'daraz');
    expect(count).toBe(2);
  });

  it('counts the two steps separately, so a Daraz problem never looks like a store problem', () => {
    expect(consecutiveFailures(0, darazFailed, 'store')).toBe(0);
    expect(consecutiveFailures(2, storeFailed, 'store')).toBe(3);
    expect(consecutiveFailures(2, storeFailed, 'store')).toBeGreaterThanOrEqual(STOP_AFTER_FAILURES);
  });
});

describe('products the old backend import left behind', () => {
  const old = (id: string, productId: string, stock: number | null = null) => ({
    _id: id,
    stock,
    source: { store: 'audionic', productId },
  });

  it('are matched to their Audionic item instead of being duplicated', () => {
    const adopted = adoptedLinks([old('p1', '101')], []);
    expect(adopted).toEqual([
      { audionicId: '101', quantumProductId: 'p1', darazItemId: null, sellerSku: 'AUD-101', sourcePkr: 0, available: true },
    ]);
  });

  it('look like a price change, so the next sync reprices them to the exact Audionic price', () => {
    const [adoptedLink] = adoptedLinks([old('p1', '101')], []);
    expect(itemStatus(item, adoptedLink, { darazReady: true, hasCategory: true })).toBe('changed');
  });

  it('keep a sold-out product sold out until Audionic says otherwise', () => {
    expect(adoptedLinks([old('p2', '102', 0)], [])[0].available).toBe(false);
  });

  it('ignore products that are already linked, that came from elsewhere, or that have no source', () => {
    const linked = link({ audionicId: '101' });
    const products = [
      old('p1', '101'),
      { _id: 'p3', stock: null, source: { store: 'other', productId: '5' } },
      { _id: 'p4', stock: null, source: null },
      { _id: 'p5', stock: null },
      old('p6', '106'),
      old('p7', '106'),
    ];
    const adopted = adoptedLinks(products, [linked]);
    expect(adopted.map((a) => a.audionicId)).toEqual(['106']);
    expect(adopted[0].quantumProductId).toBe('p6');
  });

  it('refreshes the old product in place and then sends it to Daraz', async () => {
    const [adoptedLink] = adoptedLinks([old('p1', '101')], []);
    const d = deps();
    const result = await syncItem(item, adoptedLink, d);
    expect(result).toMatchObject({ store: 'refreshed', daraz: 'listed' });
    const [id, payload] = (d.updateProduct as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(id).toBe('p1');
    expect(storedToRupees(payload.price, RATE)).toBe(3499); // exactly Audionic's price, nothing deducted
    expect(d.createProduct).not.toHaveBeenCalled();
  });
});

describe('the log', () => {
  const run = async (d: SyncDeps, it_ = item, l?: AudionicLinkRow) => {
    const lines: Array<[string, string]> = [];
    await syncItem(it_, l, { ...d, log: (text, level = 'info') => lines.push([level, text]) });
    return lines;
  };

  it('tells the story of a successful product, step by step, with the product name in every line', async () => {
    const lines = await run(deps());
    const text = lines.map(([, t]) => t);
    expect(lines.every(([, t]) => t.startsWith(`${item.name} — `))).toBe(true);
    const order = ['QuantumStore: creating', 'QuantumStore: created', 'Daraz: trying', 'Daraz: asking the AI', 'Daraz: AI done', 'Daraz: sending', 'Daraz: LISTED'];
    let last = -1;
    for (const part of order) {
      const at = text.findIndex((t) => t.includes(part));
      expect(at, part).toBeGreaterThan(last);
      last = at;
    }
    expect(text.find((t) => t.includes('Daraz: sending'))).toMatch(/Rs 3,829.*quantity 10.*SKU AUD-101/);
    expect(lines.some(([level]) => level === 'error')).toBe(false);
  });

  it('shows the exact Daraz refusal as an error line', async () => {
    const lines = await run(deps({ publishDaraz: vi.fn(async () => Promise.reject(new Error('E500: brand not allowed'))) }));
    expect(lines.at(-1)).toEqual(['error', `${item.name} — Daraz: FAILED — E500: brand not allowed`]);
  });

  it('says why Daraz was skipped instead of staying silent', async () => {
    const noCategory = await run(deps({ daraz: { ready: true, category: null } }));
    expect(noCategory.at(-1)?.[1]).toMatch(/Daraz: skipped — Choose a Daraz category for Earbuds/);
    const offline = await run(deps({ daraz: { ready: false, category: AUDIO_CATEGORY } }));
    expect(offline.at(-1)?.[1]).toMatch(/Daraz: skipped — Daraz is not connected/);
    const sold = await run(deps(), soldOut);
    expect(sold.at(-1)?.[1]).toMatch(/Daraz: skipped — Sold out on Audionic/);
  });

  it('names the missing field when the AI could not fill one', async () => {
    const lines = await run(
      deps({
        prepareDaraz: vi.fn(async () => ({
          category: null,
          attributes: {},
          package: { weight: 1, length: 2, width: 3, height: 4 },
          missing: [{ name: 'warranty_type', label: 'Warranty Type' }],
        })),
      }),
    );
    expect(lines.map(([, t]) => t).find((t) => t.includes('Daraz: AI done'))).toMatch(/still missing: Warranty Type/);
  });

  it('logs a QuantumStore failure as an error and does not mention Daraz attempts', async () => {
    const lines = await run(deps({ createProduct: vi.fn(async () => Promise.reject(new Error('backend down'))) }));
    expect(lines.at(-1)).toEqual(['error', `${item.name} — QuantumStore: FAILED — backend down`]);
    expect(lines.some(([, t]) => t.includes('Daraz: trying'))).toBe(false);
  });
});

describe('Daraz refusing the brand', () => {
  const policy =
    'E500: Create product failed — Product: BIZ_CHECK_MTEE_RISK_RULE_TRIGGER_MTEE_RISK_RULE_TRIGGER_ERROR:Failed by Policy(R_5498925): Apologies ! You are not authorized to sell this brand.';

  it('is its own outcome with an explanation, and the QuantumStore product is kept', async () => {
    const d = deps({ publishDaraz: vi.fn(async () => Promise.reject(new Error(policy))) });
    const result = await syncItem(item, undefined, d);
    expect(result).toMatchObject({ store: 'created', daraz: 'blocked' });
    expect(result.darazMessage).toMatch(/brand authorization for Audionic.*Seller Center/);
    // The "No Brand" retry happens on the server (api/daraz/publish.ts); the app asks once and reports what came back.
    expect(d.publishDaraz).toHaveBeenCalledTimes(1);
    expect(result.darazMessage).toMatch(/even as "No Brand"/);
  });

  it('still treats any other Daraz refusal as a plain failure', async () => {
    const d = deps({ publishDaraz: vi.fn(async () => Promise.reject(new Error('E500: something else'))) });
    expect((await syncItem(item, undefined, d)).daraz).toBe('failed');
  });

  it('logs the block as an error line', async () => {
    const lines: Array<[string, string]> = [];
    const d = deps({ publishDaraz: vi.fn(async () => Promise.reject(new Error(policy))), log: (t, l = 'info') => lines.push([l, t]) });
    await syncItem(item, undefined, d);
    expect(lines.at(-1)?.[0]).toBe('error');
    expect(lines.at(-1)?.[1]).toMatch(/Daraz: BLOCKED/);
  });

  it('counts refusals in a row and starts again after a listing that worked', () => {
    const blocked = { store: 'created', daraz: 'blocked' } as const;
    let n = 0;
    for (let i = 0; i < PAUSE_DARAZ_AFTER_BLOCKS - 1; i++) n = consecutiveBlocked(n, blocked);
    expect(n).toBe(PAUSE_DARAZ_AFTER_BLOCKS - 1);
    n = consecutiveBlocked(n, { store: 'created', daraz: 'skipped' });
    expect(n).toBe(PAUSE_DARAZ_AFTER_BLOCKS - 1); // skipped (sold out) says nothing
    n = consecutiveBlocked(n, { store: 'created', daraz: 'listed' });
    expect(n).toBe(0);
  });

  it('does not ask Daraz at all while a run is paused, and says why', async () => {
    const d = deps({ daraz: { ready: true, category: AUDIO_CATEGORY, pausedReason: 'Daraz paused for this run' } });
    const result = await syncItem(item, undefined, d);
    expect(result).toMatchObject({ store: 'created', daraz: 'skipped', darazMessage: 'Daraz paused for this run' });
    expect(d.prepareDaraz).not.toHaveBeenCalled();
    expect(d.publishDaraz).not.toHaveBeenCalled();
  });
});

describe('the Daraz description', () => {
  const sentDescription = async (d: SyncDeps, forItem = item) => {
    await syncItem(forItem, undefined, d);
    return (d.publishDaraz as ReturnType<typeof vi.fn>).mock.calls[0][0].description as string;
  };

  it('has at least 30 words even when Audionic wrote one line, using the AI text', async () => {
    const ai = Array.from({ length: 45 }, (_, i) => `detail${i}`).join(' ');
    const d = deps({
      prepareDaraz: vi.fn(async () => ({
        category: null,
        attributes: {},
        package: { weight: 0.2, length: 10, width: 8, height: 4 },
        description: ai,
        missing: [],
      })),
    });
    const text = await sentDescription(d);
    expect(text.split(/\s+/).length).toBeGreaterThanOrEqual(30);
    expect(text.startsWith(item.description)).toBe(true);
    expect(text).toContain(ai);
    // QuantumStore keeps Audionic's own, shorter text.
    expect((d.createProduct as ReturnType<typeof vi.fn>).mock.calls[0][0].description).toBe(item.description);
  });

  it('falls back to the specs, and stops with a clear message when there is still not enough', async () => {
    const withSpecs = toItem({ ...earbuds, body_html: '<ul><li>Battery: a long lasting 40 hour playtime on one charge</li><li>Range: reliable bluetooth up to ten metres away</li><li>Driver: large dynamic drivers for deep clear sound everywhere</li></ul>' }, kind)!;
    expect(await sentDescription(deps({ prepareDaraz: vi.fn(async () => NO_AI_TEXT) }), withSpecs)).toMatch(/Key details — /);

    const bare = { ...item, description: 'Short one.', specs: [] };
    const d = deps({ prepareDaraz: vi.fn(async () => NO_AI_TEXT) });
    const result = await syncItem(bare, undefined, d);
    expect(result).toMatchObject({ store: 'created', daraz: 'failed' });
    expect(result.darazMessage).toMatch(/at least 30 words/);
    expect(d.publishDaraz).not.toHaveBeenCalled();
  });
});

describe('ready-made Daraz data', () => {
  const known = { description: Array.from({ length: 40 }, (_, i) => `ready${i}`).join(' '), highlights: ['A', 'B', 'C'], package: { weightKg: 1, lengthCm: 10, widthCm: 8, heightCm: 5 } };

  it('is sent with the request when the product has an entry, and logged', async () => {
    const lines: string[] = [];
    const d = deps({ knownListing: (id) => (id === item.audionicId ? known : undefined), log: (t) => lines.push(t) });
    await syncItem(item, undefined, d);
    expect((d.prepareDaraz as ReturnType<typeof vi.fn>).mock.calls[0][0].known).toEqual(known);
    expect(lines.some((l) => l.includes('ready-made description and package size'))).toBe(true);
  });

  it('is not sent for a product without an entry, which then asks the AI for everything as before', async () => {
    const lines: string[] = [];
    const d = deps({ knownListing: () => undefined, log: (t) => lines.push(t) });
    await syncItem(item, undefined, d);
    expect((d.prepareDaraz as ReturnType<typeof vi.fn>).mock.calls[0][0]).not.toHaveProperty('known');
    expect(lines.some((l) => l.includes('asking the AI for the English texts'))).toBe(true);
  });
});
