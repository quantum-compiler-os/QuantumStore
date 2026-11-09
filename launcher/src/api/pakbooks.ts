import type { PakbooksItem } from '../../api/_lib/pakbooks';
import { launcherApi } from './daraz';

export type { PakbooksItem };

/** What an earlier sync made out of one PakBooks book. */
export type PakbooksLinkRow = {
  pakbooksId: string;
  quantumProductId: string;
  darazItemId: string | null;
  sellerSku: string;
  sourcePkr: number;
  available: boolean;
};

/** PakBooks' current catalog as listable items, and the links from earlier syncs. */
export async function getPakbooksCatalog() {
  // About 9,000 books in 36 pages: give the server time to read them all.
  const { data } = await launcherApi.get<{ fetched: number; items: PakbooksItem[]; links: PakbooksLinkRow[] }>('/pakbooks/catalog', {
    timeout: 120_000,
  });
  return data;
}

export async function savePakbooksLink(link: PakbooksLinkRow) {
  await launcherApi.post('/pakbooks/link', link);
}

/** One PakBooks picture, read through the Launcher's server (the browser cannot read it across sites). */
export async function downloadPakbooksImage(url: string) {
  const { data } = await launcherApi.get<Blob>('/pakbooks/image', { params: { url }, responseType: 'blob', timeout: 60_000 });
  return data;
}
