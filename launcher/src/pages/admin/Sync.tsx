import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getSyncLog, getSyncPreview, runSync, type SyncReport } from '../../api/sync';
import { useConfirm } from '../../context/ConfirmContext';
import { queryKeys } from '../../hooks/queryKeys';
import { getErrorMessage } from '../../utils/errors';

const POLL_MS = 1000;

function NameList({ title, hint, names }: { title: string; hint: string; names: string[] }) {
  if (!names.length) return null;
  return (
    <details className="daraz-details" style={{ marginBottom: '0.75rem' }}>
      <summary>
        <strong>{title}</strong> <span className="muted">· {names.length} — {hint}</span>
      </summary>
      <ul style={{ margin: 0, padding: 'var(--space-3) var(--space-4) var(--space-3) 2rem' }}>
        {names.map((name, index) => (
          <li key={`${name}-${index}`}>{name}</li>
        ))}
      </ul>
    </details>
  );
}

/**
 * Keeps QuantumStore and Daraz matching: products only on Daraz are imported, products only on QuantumStore are listed on
 * Daraz, and products deleted on one side can be removed from the other (after you confirm).
 */
export default function Sync() {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [report, setReport] = useState<SyncReport | null>(null);
  const [error, setError] = useState('');
  const logEnd = useRef<HTMLDivElement>(null);

  const preview = useQuery({ queryKey: ['sync', 'preview'], queryFn: getSyncPreview, retry: false, refetchOnWindowFocus: false });

  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: 'nearest' });
  }, [lines]);

  async function start(applyRemovals: boolean) {
    setRunning(true);
    setError('');
    setReport(null);
    setLines([]);
    let since = 0;
    let stopped = false;
    // The run is one long request; its log is read from a second one every second.
    const poll = async () => {
      while (!stopped) {
        try {
          const next = await getSyncLog(since);
          since = next.next;
          if (next.lines.length) setLines((prev) => [...prev, ...next.lines]);
        } catch {
          // a missed poll just shows up on the next one
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
    };
    const polling = poll();
    try {
      setReport(await runSync(applyRemovals));
    } catch (err) {
      setError(getErrorMessage(err, 'The sync failed'));
    } finally {
      stopped = true;
      await polling;
      try {
        const rest = await getSyncLog(since);
        if (rest.lines.length) setLines((prev) => [...prev, ...rest.lines]);
      } catch {
        // the log is a courtesy; the report above is what matters
      }
      setRunning(false);
      await Promise.all([preview.refetch(), queryClient.invalidateQueries({ queryKey: queryKeys.products.all }), queryClient.invalidateQueries({ queryKey: ['daraz'] })]);
    }
  }

  async function startWithRemovals() {
    const data = preview.data;
    if (!data) return;
    const ok = await confirm(
      `This will delete ${data.removeFromStore.length} product${data.removeFromStore.length === 1 ? '' : 's'} from QuantumStore ` +
        `(they were deleted on Daraz) and take ${data.removeFromDaraz.length} item${data.removeFromDaraz.length === 1 ? '' : 's'} off Daraz ` +
        '(they were deleted on QuantumStore). This cannot be undone.',
      { title: 'Remove the products deleted on the other side?', confirmLabel: 'Sync and remove', tone: 'danger' },
    );
    if (ok) await start(true);
  }

  const data = preview.data;
  const removals = (data?.removeFromDaraz.length ?? 0) + (data?.removeFromStore.length ?? 0);
  const additions = (data?.importToStore.length ?? 0) + (data?.listOnDaraz.length ?? 0) + (data?.link.length ?? 0);

  return (
    <div>
      <h1>Sync</h1>
      <p className="muted">
        Compares QuantumStore and Daraz. A product only on Daraz is created on QuantumStore, a product only on QuantumStore is
        listed on Daraz, and one deleted on one side can be removed from the other. The same thing runs from the terminal
        with <code>npm run sync</code>.
      </p>

      <div className="admin-quick" style={{ margin: '1rem 0', alignItems: 'center' }}>
        <button type="button" className="btn btn-ghost" disabled={preview.isFetching || running} onClick={() => preview.refetch()}>
          {preview.isFetching ? 'Checking…' : 'Check what would change'}
        </button>
        <button type="button" className="btn btn-primary" disabled={running || preview.isFetching || !data || Boolean(data.problem)} onClick={() => start(false)}>
          {running ? 'Syncing…' : additions ? `Sync now (${additions})` : 'Sync now'}
        </button>
        {removals > 0 && (
          <button type="button" className="btn btn-secondary" disabled={running || preview.isFetching || Boolean(data?.problem)} onClick={startWithRemovals}>
            Sync and remove {removals}
          </button>
        )}
      </div>

      {preview.isError && <p className="form-error">{getErrorMessage(preview.error, 'Could not compare the two shops')}</p>}
      {error && <p className="form-error">{error}</p>}
      {data?.problem && <p className="form-error">{data.problem}</p>}

      {data && !data.problem && (
        <>
          {!additions && !removals && !data.droppedLinks && <p>Everything matches — nothing to sync.</p>}
          <NameList title="Import from Daraz" hint="on Daraz, missing on QuantumStore" names={data.importToStore} />
          <NameList title="List on Daraz" hint="on QuantumStore, missing on Daraz" names={data.listOnDaraz} />
          <NameList title="Link" hint="already on both, only the pairing is saved" names={data.link} />
          <NameList title="Remove from Daraz" hint="deleted on QuantumStore" names={data.removeFromDaraz} />
          <NameList title="Remove from QuantumStore" hint="deleted on Daraz" names={data.removeFromStore} />
          <p className="muted">
            {data.skipped.managed > 0 && `${data.skipped.managed} Audionic products are handled on the Audionic page. `}
            {data.skipped.soldOut > 0 && `${data.skipped.soldOut} sold-out products are not listed on Daraz. `}
            {data.droppedLinks > 0 && `${data.droppedLinks} stale records will be cleaned up.`}
          </p>
        </>
      )}

      {report && (
        <div className="admin-form" style={{ margin: '1rem 0' }}>
          <h2>Result</h2>
          {report.problem ? (
            <p className="form-error">{report.problem}</p>
          ) : (
            <p>
              {report.imported.length} imported from Daraz, {report.listed.length} listed on Daraz, {report.linked.length} linked,{' '}
              {report.removedFromDaraz.length + report.removedFromStore.length} removed, {report.failures.length} problems.
              {report.pendingRemovals.fromDaraz.length + report.pendingRemovals.fromStore.length > 0 &&
                ` ${report.pendingRemovals.fromDaraz.length + report.pendingRemovals.fromStore.length} removals are still waiting for your confirmation.`}
            </p>
          )}
          {report.pendingRemovals.blocked && <p className="form-error">{report.pendingRemovals.blocked}</p>}
          {report.failures.length > 0 && (
            <ul>
              {report.failures.map((failure, index) => (
                <li key={index} className="form-error">
                  {failure.action}: {failure.name} — {failure.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <details className="daraz-details" open style={{ margin: '1rem 0' }}>
        <summary>
          <strong>Log</strong> <span className="muted">· every step ({lines.length})</span>
        </summary>
        <div style={{ padding: 'var(--space-3) var(--space-4)', display: 'grid', gap: 'var(--space-3)' }}>
          <div className="admin-quick">
            <button type="button" className="btn btn-ghost" disabled={!lines.length} onClick={() => void navigator.clipboard?.writeText(lines.join('\n'))}>
              Copy log
            </button>
          </div>
          <div
            role="log"
            aria-live="polite"
            style={{ maxHeight: '22rem', overflow: 'auto', fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '0.8rem', lineHeight: 1.5 }}
          >
            {lines.length === 0 && <span className="muted">Nothing yet — press Sync now and every step shows up here.</span>}
            {lines.map((line, index) => (
              <div key={index} style={/FAILED|stopped|NOT applied/i.test(line) ? { color: 'var(--danger, #dc2626)' } : undefined}>
                {line}
              </div>
            ))}
            <div ref={logEnd} />
          </div>
        </div>
      </details>
    </div>
  );
}
