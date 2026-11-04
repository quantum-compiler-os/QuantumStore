import type { CamshamItem } from '../../api/_lib/camsham';
import { launcherApi } from './daraz';

export type { CamshamItem };

/** What an earlier sync made out of one CamSham product. */
export type CamshamLinkRow = {
  camshamId: string;
  quantumProductId: string;
  darazItemId: string | null;
  sellerSku: string;
  sourcePkr: number;
  available: boolean;
};

/** CamSham's current catalog as listable items, and the links from earlier syncs. */
export async function getCamshamCatalog() {
  const { data } = await launcherApi.get<{ fetched: number; items: CamshamItem[]; links: CamshamLinkRow[] }>('/camsham/catalog');
  return data;
}

export async function saveCamshamLink(link: CamshamLinkRow) {
  await launcherApi.post('/camsham/link', link);
}

/** One camsham.pk picture, read through the Launcher's server (the browser cannot read it across sites). */
export async function downloadCamshamImage(url: string) {
  const { data } = await launcherApi.get<Blob>('/camsham/image', { params: { url }, responseType: 'blob', timeout: 60_000 });
  return data;
}
