import type { ProductImage } from './productForm';

type Deps = {
  /** Reads an image the backend already holds (e.g. `/uploads/x.webp`). */
  download: (url: string) => Promise<Blob>;
  /** Uploads a file through the backend and returns its stored address. */
  upload: (file: File) => Promise<{ url: string; thumbnail?: string }>;
};

export const isPublicUrl = (url: string) => /^https:\/\//i.test(url);

/**
 * Daraz downloads product images from the internet, so every image must be a public https address.
 * Images the backend kept on its own disk are sent through the upload again; if the backend still answers
 * with a non-public address, its storage is not set to Google Drive and the error says so.
 */
export async function ensurePublicImages(images: ProductImage[], { download, upload }: Deps) {
  let changed = false;
  const result: ProductImage[] = [];

  for (const image of images) {
    if (isPublicUrl(image.url)) {
      result.push(image);
      continue;
    }
    let stored: { url: string; thumbnail?: string };
    try {
      const blob = await download(image.url);
      const file = new File([blob], 'product-image', { type: blob.type || 'image/webp' });
      stored = await upload(file);
    } catch {
      throw new Error(`Could not read ${image.url} to upload it again — remove the image and add it once more`);
    }
    if (!isPublicUrl(stored.url)) {
      throw new Error(
        'The backend is saving images on its own disk, so Daraz cannot reach them. Set STORAGE_DRIVER=gdrive and the Google Drive settings on the backend (Vercel environment variables), then redeploy it',
      );
    }
    result.push({ url: stored.url, thumbnail: stored.thumbnail || stored.url });
    changed = true;
  }

  return { images: result, changed };
}
