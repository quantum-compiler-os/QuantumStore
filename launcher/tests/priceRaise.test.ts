import { describe, expect, it, vi } from 'vitest';
import { raisePrices, type PricedProduct, type RaiseDeps, type RaiseRecord } from '../api/_lib/priceRaise';
import { rupeesToStored, storedToRupees } from '../shared/pricing';

const RATE = 278;

const product = (id: string, rupees: number, extra: Partial<PricedProduct> = {}): PricedProduct => ({
  id,
  name: `Product ${id}`,
  productType: 'standard',
  price: rupeesToStored(rupees, RATE),
  variants: [],
  ...extra,
});

/** A small in-memory store and record table, so several calls of one run can be played through. */
function world(products: PricedProduct[]) {
  const live = new Map(products.map((p) => [p.id, { ...p }]));
  const records: RaiseRecord[] = [];
  const deps = (extra: Partial<RaiseDeps> = {}): RaiseDeps => ({
    store: {
      products: async () => [...live.values()].map((p) => ({ ...p, variants: p.variants.map((v) => ({ ...v })) })),
      rate: async () => RATE,
      update: vi.fn(async (id: string, payload: { price: number; variants?: PricedProduct['variants'] }) => {
        const current = live.get(id)!;
        live.set(id, { ...current, price: payload.price, variants: payload.variants ?? current.variants });
      }),
    },
    daraz: { skus: async () => [], update: vi.fn() },
    records: {
      forRun: async (runId) => records.filter((r) => r.runId === runId),
      save: async (record) => {
        const at = records.findIndex((r) => r.runId === record.runId && r.key === record.key && r.target === record.target);
        if (at >= 0) records[at] = record;
        else records.push(record);
      },
    },
    today: () => '2026-11-11',
    log: () => {},
    ...extra,
  });
  const rupeesOf = (id: string) => storedToRupees(live.get(id)!.price, RATE);
  return { live, records, deps, rupeesOf };
}

const options = { amount: 2000, runId: 'plus-2000-store', targets: ['store' as const] };

describe('raisePrices on QuantumStore', () => {
  it('previews without changing anything', async () => {
    const w = world([product('a', 3499)]);
    const deps = w.deps();
    const report = await raisePrices(deps, { ...options, apply: false });
    expect(report.changed.map((l) => [l.from, l.to])).toEqual([[3499, 5499]]);
    expect(deps.store.update).not.toHaveBeenCalled();
    expect(w.rupeesOf('a')).toBe(3499);
  });

  it('adds the amount to the price and every variant, and leaves gift cards and unpriced products alone', async () => {
    const w = world([
      product('a', 3499, { variants: [{ label: 'Black', price: rupeesToStored(3499, RATE), stock: 3 }, { label: 'XL', price: rupeesToStored(3999, RATE) }] }),
      product('gift', 5000, { productType: 'gift_card' }),
      product('free', 0),
    ]);
    const report = await raisePrices(w.deps(), { ...options, apply: true });
    expect(w.rupeesOf('a')).toBe(5499);
    expect(w.live.get('a')!.variants.map((v) => [v.label, storedToRupees(v.price, RATE), v.stock])).toEqual([
      ['Black', 5499, 3],
      ['XL', 5999, undefined],
    ]);
    expect(w.rupeesOf('gift')).toBe(5000);
    expect(report.skipped.map((s) => s.key).sort()).toEqual(['free', 'gift']);
    expect(report.unfinished).toBe(false);
  });

  it('never adds twice under the same run id', async () => {
    const w = world([product('a', 1000)]);
    await raisePrices(w.deps(), { ...options, apply: true });
    const again = await raisePrices(w.deps(), { ...options, apply: true });
    expect(w.rupeesOf('a')).toBe(3000);
    expect(again.changed).toEqual([]);
    expect(again.done.map((l) => l.key)).toEqual(['a']);
  });

  it('stops for time after at least one change, and the next call with the same run id finishes the rest', async () => {
    const w = world([product('a', 1000), product('b', 2000), product('c', 3000)]);
    let calls = 0;
    // Out of time as soon as anything was asked: each call gets exactly one change done.
    const outOfTime = () => {
      calls += 1;
      return true;
    };
    const first = await raisePrices(w.deps({ outOfTime }), { ...options, apply: true });
    expect(first.unfinished).toBe(true);
    expect(first.stopped).toBeNull();
    expect(first.changed).toHaveLength(1);

    const second = await raisePrices(w.deps({ outOfTime }), { ...options, apply: true });
    const third = await raisePrices(w.deps({ outOfTime }), { ...options, apply: true });
    expect([second.changed.length, third.changed.length]).toEqual([1, 1]);
    expect(third.unfinished).toBe(false);
    expect(third.done).toHaveLength(2);
    expect(['a', 'b', 'c'].map(w.rupeesOf)).toEqual([3000, 4000, 5000]);
    expect(calls).toBeGreaterThan(0);
  });

  it('does not count a preview against the time budget', async () => {
    const w = world([product('a', 1000), product('b', 2000)]);
    const report = await raisePrices(w.deps({ outOfTime: () => true }), { ...options, apply: false });
    expect(report.changed).toHaveLength(2);
    expect(report.unfinished).toBe(false);
  });

  it('leaves a product someone repriced after this run changed it, instead of adding again', async () => {
    const w = world([product('a', 1000)]);
    await raisePrices(w.deps(), { ...options, apply: true });
    w.live.set('a', { ...w.live.get('a')!, price: rupeesToStored(1500, RATE) });
    const again = await raisePrices(w.deps(), { ...options, apply: true });
    expect(w.rupeesOf('a')).toBe(1500);
    expect(again.skipped.map((s) => s.key)).toEqual(['a']);
  });
});
