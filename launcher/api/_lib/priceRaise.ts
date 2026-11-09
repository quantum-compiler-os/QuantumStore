import { rupeesToStored, storedToRupees } from '../../shared/pricing.js';
import type { DarazSku, PriceQuantityChange } from './darazCore.js';
import { HttpError } from './http.js';

/**
 * Adds a fixed number of rupees to every price on QuantumStore and/or Daraz (`npm run raise-prices`).
 *
 * Adding is not safe to repeat, so each change is saved under a run id with its old and new prices just before it is
 * made. A re-run with the same id compares every live price with what was saved: already at the new price → done, left
 * alone; still at the old price → the earlier attempt failed, changed now; anything else → someone changed it in
 * between, only reported. Both shops are read before anything changes, and nothing changes at all without `apply`.
 */

export type RaiseTarget = 'store' | 'daraz';

/** A QuantumStore product as the raise reads it. Prices are the stored values (rupees ÷ PKR rate). */
export type PricedProduct = {
  id: string;
  name: string;
  productType: string;
  price: number;
  /** Kept whole: the backend replaces the variant list, so labels and stock are sent back as they were. */
  variants: Array<{ label: string; price: number } & Record<string, unknown>>;
};

/** Rupee prices of a QuantumStore product: its own and each variant's, in order. */
export type StorePrices = { price: number; variants: number[] };
/** Rupee prices of one Daraz SKU. */
export type DarazPrices = { price: number; specialPrice: number | null };

export type RaiseRecord = {
  runId: string;
  target: RaiseTarget;
  /** QuantumStore product id, or Daraz SKU id. */
  key: string;
  name: string;
  from: StorePrices | DarazPrices;
  to: StorePrices | DarazPrices;
};

export type RaiseDeps = {
  store: {
    products: () => Promise<PricedProduct[]>;
    /** PKR per stored price unit. */
    rate: () => Promise<number>;
    update: (id: string, payload: { price: number; variants?: PricedProduct['variants'] }) => Promise<unknown>;
  };
  daraz: {
    skus: () => Promise<DarazSku[]>;
    update: (sku: DarazSku, change: PriceQuantityChange) => Promise<unknown>;
  };
  records: {
    forRun: (runId: string) => Promise<RaiseRecord[]>;
    save: (record: RaiseRecord) => Promise<unknown>;
  };
  /** Today as yyyy-MM-dd, to tell a running Daraz sale from one that has ended. */
  today: () => string;
  log: (text: string) => void;
};

export type RaiseOptions = { amount: number; runId: string; apply: boolean; targets: RaiseTarget[] };

export type RaiseLine = { target: RaiseTarget; key: string; name: string; from: number; to: number; note: string };
export type RaiseProblem = { target: RaiseTarget; key: string; name: string; reason: string };

export type RaiseReport = {
  runId: string;
  amount: number;
  apply: boolean;
  /** Changed by this call, or in a preview, would be. */
  changed: RaiseLine[];
  /** Already at the new price from an earlier call with the same run id. */
  done: RaiseLine[];
  skipped: RaiseProblem[];
  failures: RaiseProblem[];
  /** Why the run stopped before the end, or null when it went through everything. */
  stopped: string | null;
};

/** After this many failures in a row the run stops: something is wrong for every product, not just one. */
export const MAX_FAILURES_IN_A_ROW = 5;
/** Session expired, not allowed, Daraz disconnected, rate limited: every following change would fail the same way. */
const STOP_STATUSES = new Set([401, 403, 409, 429]);

const SHOP: Record<RaiseTarget, string> = { store: 'QuantumStore', daraz: 'Daraz' };

const paisa = (n: number) => Math.round(n * 100) / 100;
const same = (a: number | null, b: number | null) => (a === null || b === null ? a === b : Math.abs(a - b) < 0.005);
const reasonOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

export const rupees = (n: number) => `Rs ${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

export function storePricesOf(product: PricedProduct, rate: number): StorePrices {
  return { price: storedToRupees(product.price, rate), variants: product.variants.map((v) => storedToRupees(v.price, rate)) };
}

export function raiseStorePrices(prices: StorePrices, amount: number): StorePrices {
  return { price: paisa(prices.price + amount), variants: prices.variants.map((v) => paisa(v + amount)) };
}

const sameStore = (a: StorePrices, b: StorePrices) =>
  same(a.price, b.price) && a.variants.length === b.variants.length && a.variants.every((v, i) => same(v, b.variants[i]));

/**
 * A Daraz SKU's new prices. A sale that is still running gets the same amount added, so shoppers see the new price and
 * the discount stays the same size. A sale that has ended is left alone.
 */
export function raiseDarazPrices(prices: DarazPrices, saleEnds: string, amount: number, today: string): DarazPrices {
  const sale = prices.specialPrice;
  const saleRunning = sale !== null && sale < prices.price && (!saleEnds || saleEnds >= today);
  return { price: paisa(prices.price + amount), specialPrice: saleRunning ? paisa(sale + amount) : sale };
}

const sameDaraz = (a: DarazPrices, b: DarazPrices) => same(a.price, b.price) && same(a.specialPrice, b.specialPrice);

export type Decision<P> =
  | { kind: 'change'; from: P; to: P; alreadySaved: boolean }
  | { kind: 'done'; from: P; to: P }
  | { kind: 'skip'; reason: string };

/** What to do with one product, from its live prices and what this run saved for it earlier (if anything). */
export function decide<P>(current: P, saved: { from: P; to: P } | undefined, raise: (p: P) => P, equal: (a: P, b: P) => boolean): Decision<P> {
  if (!saved) return { kind: 'change', from: current, to: raise(current), alreadySaved: false };
  if (equal(current, saved.to)) return { kind: 'done', from: saved.from, to: saved.to };
  if (equal(current, saved.from)) return { kind: 'change', from: saved.from, to: saved.to, alreadySaved: true };
  return { kind: 'skip', reason: 'its price was changed by someone else after this run first changed it; check it by hand' };
}

export async function raisePrices(deps: RaiseDeps, { amount, runId, apply, targets }: RaiseOptions): Promise<RaiseReport> {
  if (!Number.isFinite(amount) || amount === 0) throw new HttpError(400, 'The amount must be a number other than 0');
  const report: RaiseReport = { runId, amount, apply, changed: [], done: [], skipped: [], failures: [], stopped: null };
  const doStore = targets.includes('store');
  const doDaraz = targets.includes('daraz');

  deps.log(`Reading ${[doStore && 'QuantumStore', doDaraz && 'Daraz'].filter(Boolean).join(' and ')}…`);
  const rate = doStore ? await deps.store.rate() : 0;
  const products = doStore ? await deps.store.products() : [];
  const skus = doDaraz ? await deps.daraz.skus() : [];
  const saved = new Map((await deps.records.forRun(runId)).map((r) => [`${r.target}:${r.key}`, r]));
  deps.log(
    [doStore && `${products.length} QuantumStore products (Rs ${rate} per stored unit)`, doDaraz && `${skus.length} Daraz SKUs`]
      .filter(Boolean)
      .join(', ') + (saved.size ? `; ${saved.size} already recorded for run "${runId}"` : ''),
  );

  const skip = (base: Omit<RaiseProblem, 'reason'>, reason: string) => {
    report.skipped.push({ ...base, reason });
    deps.log(`skipped  ${SHOP[base.target]}  ${base.name}: ${reason}`);
  };

  let failuresInARow = 0;

  /** Saves the record (first time only), then makes the change. Returns false when the whole run must stop. */
  async function carryOut(
    line: RaiseLine,
    decision: { from: StorePrices | DarazPrices; to: StorePrices | DarazPrices; alreadySaved: boolean },
    change: () => Promise<unknown>,
  ) {
    const text = `${SHOP[line.target]}  ${line.name}: ${rupees(line.from)} → ${rupees(line.to)}${line.note ? ` (${line.note})` : ''}`;
    if (!apply) {
      report.changed.push(line);
      deps.log(`would change  ${text}`);
      return true;
    }
    if (!decision.alreadySaved) {
      try {
        await deps.records.save({ runId, target: line.target, key: line.key, name: line.name, from: decision.from, to: decision.to });
      } catch (err) {
        report.stopped = `Could not record the change before making it (${reasonOf(err)}), so nothing more was changed`;
        return false;
      }
    }
    try {
      await change();
    } catch (err) {
      const reason = reasonOf(err);
      report.failures.push({ target: line.target, key: line.key, name: line.name, reason });
      deps.log(`FAILED  ${text}: ${reason}`);
      failuresInARow += 1;
      if (err instanceof HttpError && STOP_STATUSES.has(err.status)) report.stopped = reason;
      else if (failuresInARow >= MAX_FAILURES_IN_A_ROW) {
        report.stopped = `${MAX_FAILURES_IN_A_ROW} changes failed in a row, so the run stopped (last: ${reason})`;
      }
      return !report.stopped;
    }
    failuresInARow = 0;
    report.changed.push(line);
    deps.log(`changed  ${text}`);
    return true;
  }

  const finish = () => {
    if (report.stopped) deps.log(`Stopped: ${report.stopped}`);
    deps.log(
      `${apply ? 'Changed' : 'Would change'} ${report.changed.length}, already done ${report.done.length}, ` +
        `skipped ${report.skipped.length}, failed ${report.failures.length}.`,
    );
    return report;
  };

  for (const product of products) {
    const base = { target: 'store' as const, key: product.id, name: product.name };
    if (product.productType === 'gift_card') {
      skip(base, "gift card: its price is the value the buyer receives");
      continue;
    }
    const current = storePricesOf(product, rate);
    if (current.price <= 0) {
      skip(base, 'has no price (Rs 0)');
      continue;
    }
    const record = saved.get(`store:${product.id}`) as { from: StorePrices; to: StorePrices } | undefined;
    const decision = decide(current, record, (p) => raiseStorePrices(p, amount), sameStore);
    if (decision.kind === 'skip') {
      skip(base, decision.reason);
      continue;
    }
    const note = product.variants.length ? `and ${product.variants.length} variant price${product.variants.length === 1 ? '' : 's'}` : '';
    const line: RaiseLine = { ...base, from: decision.from.price, to: decision.to.price, note };
    if (decision.kind === 'done') {
      report.done.push(line);
      continue;
    }
    if (decision.to.price <= 0 || decision.to.variants.some((v) => v <= 0)) {
      skip(base, 'a price would drop to Rs 0 or below');
      continue;
    }
    const to = decision.to;
    const payload = {
      price: rupeesToStored(to.price, rate),
      ...(product.variants.length
        ? { variants: product.variants.map((v, i) => ({ ...v, price: rupeesToStored(to.variants[i], rate) })) }
        : {}),
    };
    if (!(await carryOut(line, decision, () => deps.store.update(product.id, payload)))) return finish();
  }

  const today = deps.today();
  for (const sku of skus) {
    const base = { target: 'daraz' as const, key: sku.skuId, name: sku.sellerSku ? `${sku.name} [${sku.sellerSku}]` : sku.name };
    const current: DarazPrices = { price: sku.price, specialPrice: sku.specialPrice };
    if (current.price <= 0) {
      skip(base, 'has no price (Rs 0)');
      continue;
    }
    const record = saved.get(`daraz:${sku.skuId}`) as { from: DarazPrices; to: DarazPrices } | undefined;
    const decision = decide(current, record, (p) => raiseDarazPrices(p, sku.specialTo, amount, today), sameDaraz);
    if (decision.kind === 'skip') {
      skip(base, decision.reason);
      continue;
    }
    const { from, to } = decision;
    const saleChanges = to.specialPrice !== null && !same(to.specialPrice, from.specialPrice);
    const note = saleChanges ? `sale price ${rupees(from.specialPrice ?? 0)} → ${rupees(to.specialPrice ?? 0)}` : '';
    const line: RaiseLine = { ...base, from: from.price, to: to.price, note };
    if (decision.kind === 'done') {
      report.done.push(line);
      continue;
    }
    if (to.price <= 0 || (to.specialPrice !== null && to.specialPrice <= 0)) {
      skip(base, 'a price would drop to Rs 0 or below');
      continue;
    }
    const change: PriceQuantityChange = {
      price: to.price,
      ...(saleChanges
        ? { salePrice: to.specialPrice ?? undefined, saleStartDate: sku.specialFrom || undefined, saleEndDate: sku.specialTo || undefined }
        : {}),
    };
    if (!(await carryOut(line, decision, () => deps.daraz.update(sku, change)))) return finish();
  }

  return finish();
}
