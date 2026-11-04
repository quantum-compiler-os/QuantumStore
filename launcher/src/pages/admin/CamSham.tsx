import api from '../../api/client';
import { downloadCamshamImage, getCamshamCatalog, saveCamshamLink, type CamshamItem } from '../../api/camsham';
import { camshamFallbackCategory, camshamSku, fitPictureForDaraz, hostPictures, storeCategoryFor } from '../../features/camsham/camsham';
import type { Pictures } from '../../features/audionic/syncOne';
import SupplierSyncPage, { type SupplierConfig } from '../../features/suppliers/SupplierSyncPage';

async function uploadImage(file: File) {
  const body = new FormData();
  body.append('image', file);
  const { data } = await api.post<{ url: string; thumbnail?: string }>('/uploads', body, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

// Pictures already copied in this visit, so a product retried after a Groq rate limit is not uploaded a second time.
const hosted = new Map<string, Promise<Pictures>>();

const CAMSHAM: SupplierConfig<CamshamItem> = {
  name: 'CamSham',
  site: 'camsham.pk',
  intro: (
    <>
      Brings CamSham&apos;s catalog into QuantumStore and Daraz. QuantumStore gets CamSham&apos;s exact price; Daraz gets the
      price that still leaves CamSham&apos;s price after Daraz&apos;s commission. Both shops use the Daraz category chosen for
      each type. Pictures are copied to our own storage first. Items that are sold out stay on QuantumStore only.
    </>
  ),
  // v2: the first AI picks (e.g. Cameras → Tripods) are dropped in favour of the hand-picked categories.
  categoryStorageKey: 'ql_camsham_categories_v2',
  fetchCatalog: async () => {
    const { items, links } = await getCamshamCatalog();
    return { items, links: links.map(({ camshamId, ...link }) => ({ id: camshamId, ...link })) };
  },
  idOf: (item) => item.camshamId,
  sourceFor: (item) => ({ id: item.camshamId, label: 'CamSham', brand: item.brand, sellerSku: camshamSku(item.camshamId) }),
  saveLink: ({ id, ...link }) => saveCamshamLink({ camshamId: id, ...link }),
  describe: (item) => `${item.type} · ${item.brand}`,
  fallbackCategory: camshamFallbackCategory,
  builtInFirst: true,
  storeCategory: (item, daraz) => storeCategoryFor(item.type, daraz),
  hostImages: (item, log) => {
    const id = item.camshamId;
    let copy = hosted.get(id);
    if (!copy) {
      copy = hostPictures(item.darazImages, {
        download: async (url) => fitPictureForDaraz(await downloadCamshamImage(url)),
        upload: uploadImage,
        copiesOf: (url) => item.pictureCopies?.[url] ?? [],
        onSkip: (url, reason) => log(`${item.name} — picture left out (${reason}): ${url}`, 'error'),
      });
      copy.catch(() => hosted.delete(id));
      hosted.set(id, copy);
    }
    return copy;
  },
};

export default function CamSham() {
  return <SupplierSyncPage config={CAMSHAM} />;
}
