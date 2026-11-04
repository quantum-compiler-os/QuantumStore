import { useCallback } from 'react';
import { getAudionicCatalog, saveAudionicLink, type AudionicItem } from '../../api/audionic';
import { adoptedLinks, audionicSource } from '../../features/audionic/syncOne';
import { fallbackCategory } from '../../features/audionic/categoryFallback';
import SupplierSyncPage, { type SupplierConfig, type SupplierLinkRow } from '../../features/suppliers/SupplierSyncPage';
import { knownListingFor } from '../../../shared/knownListing';
import { useAudionicProducts } from '../../hooks/useProducts';

const toRow = ({ audionicId, ...link }: { audionicId: string } & Omit<SupplierLinkRow, 'id'>): SupplierLinkRow => ({ id: audionicId, ...link });

const AUDIONIC: SupplierConfig<AudionicItem> = {
  name: 'Audionic',
  site: 'audionic.co',
  intro: (
    <>
      Brings Audionic&apos;s catalog into QuantumStore and Daraz at Audionic&apos;s own prices. Daraz gets the price that
      still leaves Audionic&apos;s price after Daraz&apos;s commission. Items that are sold out stay on QuantumStore only.
    </>
  ),
  categoryStorageKey: 'ql_audionic_categories',
  fetchCatalog: async () => {
    const { items, links } = await getAudionicCatalog();
    return { items, links: links.map(toRow) };
  },
  idOf: (item) => item.audionicId,
  sourceFor: audionicSource,
  saveLink: ({ id, ...link }) => saveAudionicLink({ audionicId: id, ...link }),
  describe: (item) => item.type,
  fallbackCategory,
  knownListing: knownListingFor,
};

export default function Audionic() {
  // Products the old backend sync imported are matched to their Audionic item (and repriced), never duplicated.
  const { data: backendAudionic } = useAudionicProducts();
  const adopt = useCallback(
    (saved: SupplierLinkRow[]) =>
      adoptedLinks(backendAudionic || [], saved.map(({ id, ...link }) => ({ audionicId: id, ...link }))).map(toRow),
    [backendAudionic],
  );
  return (
    <SupplierSyncPage
      config={AUDIONIC}
      adopt={adopt}
      adoptedNotice={(count) => (
        <>
          {count} products already on QuantumStore came from the old Audionic import (listed Rs 100 below Audionic).
          Syncing them sets Audionic&apos;s exact price and lists them on Daraz; no copies are made.
        </>
      )}
    />
  );
}
