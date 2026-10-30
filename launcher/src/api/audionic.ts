import type { AudionicItem } from '../../api/_lib/audionic';
import { launcherApi } from './daraz';

export type { AudionicItem };

/** What an earlier sync made out of one Audionic product. */
export type AudionicLinkRow = {
  audionicId: string;
  quantumProductId: string;
  darazItemId: string | null;
  sellerSku: string;
  sourcePkr: number;
  available: boolean;
};

/** Audionic's current catalog as listable items, and the links from earlier syncs. */
export async function getAudionicCatalog() {
  const { data } = await launcherApi.get<{ fetched: number; items: AudionicItem[]; links: AudionicLinkRow[] }>(
    '/audionic/catalog',
  );
  return data;
}

export async function saveAudionicLink(link: AudionicLinkRow) {
  await launcherApi.post('/audionic/link', link);
}
