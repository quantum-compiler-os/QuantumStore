import { logLine } from './log.js';
import type { SyncReport } from './syncRun.js';

/**
 * What the one sync run in progress has said so far, for the Sync page (and `npm run sync`) to show live. Held in memory
 * because the Launcher is a single local process; only one run can be going at a time.
 */
type State = { running: boolean; lines: string[]; report: SyncReport | null; startedAt: number };

const MAX_LINES = 2000;
const state: State = { running: false, lines: [], report: null, startedAt: 0 };

export function startRun() {
  if (state.running) return false;
  state.running = true;
  state.lines = [];
  state.report = null;
  state.startedAt = Date.now();
  return true;
}

export function finishRun(report: SyncReport | null) {
  state.running = false;
  state.report = report;
}

/** Records a line for the page and prints it in the terminal that runs the Launcher. */
export function logSync(text: string) {
  const stamp = new Date().toLocaleTimeString('en-GB');
  state.lines.push(`${stamp}  ${text}`);
  if (state.lines.length > MAX_LINES) state.lines.splice(0, state.lines.length - MAX_LINES);
  logLine(`sync: ${text}`);
}

/** Lines after the first `since` of this run (the count only grows within a run). */
export function readLog(since: number) {
  return { running: state.running, lines: state.lines.slice(Math.max(0, since)), next: state.lines.length, report: state.running ? null : state.report };
}
