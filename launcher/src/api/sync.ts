import type { SyncPreview, SyncReport } from '../../api/_lib/syncRun';
import { launcherApi } from './daraz';

export type { SyncPreview, SyncReport };

/** What a sync would do right now, without doing any of it. */
export async function getSyncPreview() {
  const { data } = await launcherApi.get<{ preview: SyncPreview }>('/sync/scan');
  return data.preview;
}

/** Runs the sync and resolves when it has finished (it can take minutes; read /sync/log meanwhile). */
export async function runSync(applyRemovals: boolean) {
  const { data } = await launcherApi.post<{ report: SyncReport }>('/sync/run', { applyRemovals }, { timeout: 0 });
  return data.report;
}

export async function getSyncLog(since: number) {
  const { data } = await launcherApi.get<{ running: boolean; lines: string[]; next: number }>('/sync/log', {
    params: { since },
  });
  return data;
}
