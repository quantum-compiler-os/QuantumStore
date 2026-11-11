import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { raisePrices, type RaiseTarget, type RaiseTotals } from '../../api/prices';
import { useConfirm } from '../../context/ConfirmContext';
import { queryKeys } from '../../hooks/queryKeys';
import { getErrorMessage } from '../../utils/errors';

const rs = (n: number) => `Rs ${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

/** A run name the server accepts (letters, digits, dots, dashes, underscores), e.g. "plus-2000-store". */
const defaultRunName = (amount: number, targets: RaiseTarget[]) =>
  `${amount < 0 ? 'minus' : 'plus'}-${Math.abs(amount) || 0}-${targets.join('-') || 'none'}`;

/**
 * Adds a fixed number of rupees to every price on QuantumStore (and, if ticked, Daraz). Every change is recorded
 * under the run name first, so pressing it again with the same name finishes an interrupted run and never adds twice.
 */
export default function RaisePricesCard() {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState(2000);
  const [store, setStore] = useState(true);
  const [daraz, setDaraz] = useState(false);
  const [runName, setRunName] = useState('');
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [result, setResult] = useState<RaiseTotals | null>(null);
  const [error, setError] = useState('');
  const logEnd = useRef<HTMLDivElement>(null);

  const targets: RaiseTarget[] = [...(store ? (['store'] as const) : []), ...(daraz ? (['daraz'] as const) : [])];
  const runId = runName.trim() || defaultRunName(amount, targets);
  const shops = [store && 'QuantumStore', daraz && 'Daraz'].filter(Boolean).join(' and ');
  const invalid = !Number.isFinite(amount) || amount === 0 ? 'Enter an amount other than 0' : !targets.length ? 'Tick at least one shop' : '';

  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: 'nearest' });
  }, [lines]);

  async function run(apply: boolean) {
    if (invalid) return;
    if (apply) {
      const ok = await confirm(
        `${amount > 0 ? 'Add' : 'Take'} ${rs(Math.abs(amount))} ${amount > 0 ? 'to' : 'off'} every price on ${shops}, ` +
          'variant prices included (gift cards are left alone). Shoppers see the new prices straight away.',
        { title: 'Change every price?', confirmLabel: `${amount > 0 ? 'Add' : 'Take off'} ${rs(Math.abs(amount))}` },
      );
      if (!ok) return;
    }
    setBusy(apply ? 'apply' : 'preview');
    setError('');
    setResult(null);
    setLines([]);
    try {
      setResult(await raisePrices({ amount, runId, apply, targets }, (line) => setLines((prev) => [...prev, line])));
    } catch (err) {
      setError(getErrorMessage(err, 'The price change failed'));
    } finally {
      setBusy(null);
      if (apply) await queryClient.invalidateQueries({ queryKey: queryKeys.products.all });
    }
  }

  const report = result?.report;

  return (
    <section className="admin-form">
      <h2>Add to every price</h2>
      <p className="muted">
        Adds the amount to every product price, variants included. Preview shows what would change; nothing changes until you
        press the second button. Pressing it again with the same run name finishes an interrupted run and never adds the amount
        twice; use a new run name for a new raise later.
      </p>
      <div className="form-grid">
        <label>
          Rupees to add (negative takes off)
          <input className="input" type="number" step="1" value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
        </label>
        <label>
          Run name
          <input
            className="input"
            value={runName}
            placeholder={defaultRunName(amount, targets)}
            pattern="[A-Za-z0-9._\-]{1,80}"
            onChange={(e) => setRunName(e.target.value.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 80))}
          />
        </label>
      </div>
      <label className="checkbox-row">
        <input type="checkbox" checked={store} onChange={(e) => setStore(e.target.checked)} />
        QuantumStore
      </label>
      <label className="checkbox-row">
        <input type="checkbox" checked={daraz} onChange={(e) => setDaraz(e.target.checked)} />
        Daraz (a running Daraz sale price goes up by the same amount)
      </label>
      <div className="admin-quick" style={{ alignItems: 'center' }}>
        <button type="button" className="btn btn-ghost" disabled={Boolean(busy || invalid)} onClick={() => run(false)}>
          {busy === 'preview' ? 'Checking…' : 'Preview'}
        </button>
        <button type="button" className="btn btn-primary" disabled={Boolean(busy || invalid)} onClick={() => run(true)}>
          {busy === 'apply'
            ? 'Changing prices…'
            : `${amount > 0 ? 'Add' : 'Take off'} ${rs(Math.abs(amount || 0))} ${shops ? `on ${shops}` : ''}`}
        </button>
      </div>
      {invalid && <p className="muted">{invalid}.</p>}
      {error && <p className="form-error">{error}</p>}

      {result && report && (
        <div>
          <p>
            <strong>
              {report.apply ? 'Changed' : 'Would change'} {result.changed} price{result.changed === 1 ? '' : 's'}
            </strong>
            {result.doneBefore > 0 && `, ${result.doneBefore} already done earlier under "${report.runId}"`}
            {report.skipped.length > 0 && `, ${report.skipped.length} skipped`}
            {report.failures.length > 0 && `, ${report.failures.length} failed`}.
          </p>
          {report.stopped && <p className="form-error">Stopped: {report.stopped}. Press the button again to carry on.</p>}
          {report.failures.length + report.skipped.length > 0 && (
            <ul>
              {report.failures.map((f) => (
                <li key={`f-${f.target}-${f.key}`} className="form-error">
                  {f.name}: {f.reason}
                </li>
              ))}
              {report.skipped.map((s) => (
                <li key={`s-${s.target}-${s.key}`} className="muted">
                  {s.name}: {s.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {(lines.length > 0 || busy) && (
        <details className="daraz-details" open>
          <summary>
            <strong>Log</strong> <span className="muted">· {lines.length} lines</span>
          </summary>
          <div
            role="log"
            aria-live="polite"
            style={{
              maxHeight: '18rem',
              overflow: 'auto',
              padding: 'var(--space-3) var(--space-4)',
              fontFamily: 'ui-monospace, Consolas, monospace',
              fontSize: '0.8rem',
              lineHeight: 1.5,
            }}
          >
            {lines.map((line, index) => (
              <div key={index} style={/FAILED|Stopped/.test(line) ? { color: 'var(--danger, #dc2626)' } : undefined}>
                {line}
              </div>
            ))}
            <div ref={logEnd} />
          </div>
        </details>
      )}
    </section>
  );
}
