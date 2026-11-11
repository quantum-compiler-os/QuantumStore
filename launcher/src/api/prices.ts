import type { RaiseReport, RaiseTarget } from '../../api/_lib/priceRaise';

export type { RaiseReport, RaiseTarget };

export type RaiseRequest = { amount: number; runId: string; apply: boolean; targets: RaiseTarget[] };

/** One call to /prices/raise: streams its log lines to `onLog` and resolves with its report. */
async function raiseOnce(request: RaiseRequest, onLog: (line: string) => void): Promise<RaiseReport | null> {
  const token = localStorage.getItem('ql_token');
  const response = await fetch('/launcher-api/prices/raise', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(request),
  });
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.message || `The price change could not start (HTTP ${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  let report: RaiseReport | null = null;
  const handle = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as { type: string; text?: string; report?: RaiseReport; message?: string };
    if (event.type === 'log' && event.text) onLog(event.text);
    else if (event.type === 'report' && event.report) report = event.report;
    else if (event.type === 'error') throw new Error(event.message || 'The price change failed');
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });
    const lines = buffered.split('\n');
    buffered = lines.pop() ?? '';
    lines.forEach(handle);
  }
  handle(buffered + decoder.decode());
  // No report: the function was cut off. Safe to call again: the run id makes the server skip what is done.
  return report;
}

/** The most calls one run makes before giving up (each handles ~18 s of changes). */
const MAX_CALLS = 60;

export type RaiseTotals = {
  report: RaiseReport;
  /** Changed (or, in a preview, would change) across all calls of this run. */
  changed: number;
  /** Already raised by an earlier run with the same run id, before this one started. */
  doneBefore: number;
};

/**
 * Adds `amount` rupees to every price, calling the server again with the same run id while it reports that it ran
 * out of time, so a big catalog goes through in several short calls without anything being raised twice.
 */
export async function raisePrices(request: RaiseRequest, onLog: (line: string) => void): Promise<RaiseTotals> {
  let changed = 0;
  let doneBefore: number | null = null;
  for (let call = 1; call <= MAX_CALLS; call += 1) {
    if (call > 1) onLog(`— continuing (part ${call}) —`);
    const report = await raiseOnce(request, onLog);
    if (!report) continue;
    changed += report.changed.length;
    doneBefore ??= report.done.length;
    if (!report.unfinished || report.stopped) return { report, changed, doneBefore };
  }
  throw new Error(`Still not finished after ${MAX_CALLS} parts. Press the button again: it carries on where it stopped.`);
}
