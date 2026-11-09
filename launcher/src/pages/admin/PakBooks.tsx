import api from '../../api/client';
import { downloadPakbooksImage, getPakbooksCatalog, savePakbooksLink, type PakbooksItem } from '../../api/pakbooks';
import type { Pictures } from '../../features/audionic/syncOne';
import { fitPictureForDaraz, hostPictures, storeCategoryFor } from '../../features/camsham/camsham';
import { pakbooksFallbackCategory, pakbooksSku } from '../../features/pakbooks/pakbooks';
import SupplierSyncPage, { type SupplierConfig } from '../../features/suppliers/SupplierSyncPage';

async function uploadImage(file: File) {
  const body = new FormData();
  body.append('image', file);
  const { data } = await api.post<{ url: string; thumbnail?: string }>('/uploads', body, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

// Pictures already copied in this visit, so a book retried after a Groq wait is not uploaded a second time.
const hosted = new Map<string, Promise<Pictures>>();

/** Books carry their author, not a brand; Daraz takes them as "No Brand". */
const BOOK_BRAND = 'No Brand';

const PAKBOOKS: SupplierConfig<PakbooksItem> = {
  name: 'PakBooks',
  site: 'pakbooks.com',
  intro: (
    <>
      Brings PakBooks&apos; books into QuantumStore and Daraz. QuantumStore gets PakBooks&apos; exact price; Daraz gets the
      price that still leaves PakBooks&apos; price after Daraz&apos;s commission. Books are grouped by PakBooks&apos;
      collections (Fiction, Islam &amp; Religion…), each with its own Daraz category, and listed as &quot;No Brand&quot;
      with the author in the details. Every book not yet synced starts ticked; the run can be stopped at any time and
      picks up where it left off next time. To send only some, filter (e.g. by type) and untick the rest.
    </>
  ),
  // v2: the first picks (Fiction → Science Fiction, Books → Law Books) are dropped for ones matched to Daraz's real tree.
  categoryStorageKey: 'ql_pakbooks_categories_v2',
  fetchCatalog: async () => {
    const { items, links } = await getPakbooksCatalog();
    return { items, links: links.map(({ pakbooksId, ...link }) => ({ id: pakbooksId, ...link })) };
  },
  idOf: (item) => item.pakbooksId,
  sourceFor: (item) => ({ id: item.pakbooksId, label: 'PakBooks', brand: BOOK_BRAND, sellerSku: pakbooksSku(item.pakbooksId) }),
  saveLink: ({ id, ...link }) => savePakbooksLink({ pakbooksId: id, ...link }),
  describe: (item) => [item.type, item.author].filter(Boolean).join(' · '),
  fallbackCategory: pakbooksFallbackCategory,
  // About 20 types: the hand-picked book categories are used first, so no Groq requests are spent on choosing them.
  builtInFirst: true,
  storeCategory: (item, daraz) => storeCategoryFor(item.type, daraz),
  // Daraz refuses PakBooks' GIF covers and covers under 330×330 px, so each picture is copied to our own storage as a
  // JPEG (enlarged when small) before the book is listed.
  hostImages: (item, log) => {
    const id = item.pakbooksId;
    let copy = hosted.get(id);
    if (!copy) {
      copy = hostPictures(item.darazImages, {
        download: async (url) => fitPictureForDaraz(await downloadPakbooksImage(url)),
        upload: uploadImage,
        onSkip: (url, reason) => log(`${item.name} — picture left out (${reason}): ${url}`, 'error'),
        label: 'PakBooks',
      });
      copy.catch(() => hosted.delete(id));
      hosted.set(id, copy);
    }
    return copy;
  },
};

export default function PakBooks() {
  return <SupplierSyncPage config={PAKBOOKS} />;
}
