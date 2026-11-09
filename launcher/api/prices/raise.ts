import { requireOwner } from '../_lib/auth.js';
import { getAccessToken, listDarazSkus, updatePriceQuantity } from '../_lib/daraz.js';
import { priceRaiseCollection } from '../_lib/db.js';
import { HttpError, route } from '../_lib/http.js';
import { logLine } from '../_lib/log.js';
import { raisePrices, type RaiseDeps, type RaiseOptions, type RaiseRecord, type RaiseTarget } from '../_lib/priceRaise.js';
import { storeClient } from '../_lib/storeApi.js';
import { readLog } from '../_lib/syncState.js';

let running = false;

function readOptions(body: unknown): RaiseOptions {
  const { amount, runId, apply, targets } = (body || {}) as Record<string, unknown>;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount === 0) {
    throw new HttpError(400, 'Send the amount in rupees, a number other than 0');
  }
  if (typeof runId !== 'string' || !/^[A-Za-z0-9._-]{1,80}$/.test(runId)) {
    throw new HttpError(400, 'Send a run id made of letters, digits, dots, dashes or underscores');
  }
  const chosen = Array.isArray(targets) ? targets : ['store', 'daraz'];
  if (!chosen.length || chosen.some((t) => t !== 'store' && t !== 'daraz')) {
    throw new HttpError(400, 'Targets must be "store" and/or "daraz"');
  }
  return { amount, runId, apply: apply === true, targets: chosen as RaiseTarget[] };
}

function realRaiseDeps(authorization: string, log: (text: string) => void): RaiseDeps {
  const store = storeClient(authorization);
  return {
    store: { products: store.pricedProducts, rate: store.rate, update: store.updateProduct },
    daraz: {
      skus: async () => listDarazSkus(await getAccessToken()),
      update: async (sku, change) => updatePriceQuantity({ itemId: sku.itemId, skuId: sku.skuId }, change, await getAccessToken()),
    },
    records: {
      forRun: async (runId) => {
        const rows = await (await priceRaiseCollection()).find({ runId }).toArray();
        return rows as unknown as RaiseRecord[];
      },
      save: async (record) => {
        const _id = `${record.runId}:${record.target}:${record.key}`;
        await (await priceRaiseCollection()).replaceOne({ _id }, { _id, ...record, at: new Date() }, { upsert: true });
      },
    },
    today: () => new Date().toLocaleDateString('en-CA'),
    log,
  };
}

/**
 * Adds `amount` rupees to every price on QuantumStore and/or Daraz; only previews unless `apply` is true. See
 * api/_lib/priceRaise.ts. The answer is newline-delimited JSON: `{type:"log"}` lines while it runs, then one
 * `{type:"report"}` (or `{type:"error"}`), so `npm run raise-prices` can show progress live.
 */
export default route('POST', async (req, res) => {
  await requireOwner(req);
  const options = readOptions(req.body);
  if (running) throw new HttpError(409, 'A price change is already running — wait for it to finish');
  if (readLog(0).running) throw new HttpError(409, 'A sync is running — wait for it to finish first');

  running = true;
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.flushHeaders();
  const send = (event: unknown) => res.write(`${JSON.stringify(event)}\n`);
  const log = (text: string) => {
    logLine(`prices: ${text}`);
    send({ type: 'log', text });
  };

  try {
    log(
      `${options.apply ? 'Adding' : 'Preview: adding'} Rs ${options.amount} to every price on ` +
        `${options.targets.map((t) => (t === 'store' ? 'QuantumStore' : 'Daraz')).join(' and ')} (run "${options.runId}")`,
    );
    const report = await raisePrices(realRaiseDeps(String(req.headers.authorization), log), options);
    send({ type: 'report', report });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logLine(`prices: stopped: ${message}`);
    send({ type: 'error', message });
  } finally {
    running = false;
    res.end();
  }
});
