/** Daraz refuses images with a side below this many pixels (IMAGE_DIMENSION_BELOW_LOWER_LIMIT). */
export const MIN_IMAGE_SIDE = 330;

/** The size an image must be enlarged to so both sides reach the minimum, or null if it is already big enough. */
export function enlargedSize(width: number, height: number) {
  const shortest = Math.min(width, height);
  if (shortest >= MIN_IMAGE_SIDE || shortest <= 0) return null;
  const scale = MIN_IMAGE_SIDE / shortest;
  return { width: Math.ceil(width * scale), height: Math.ceil(height * scale) };
}

/** The images in a paste to upload. Text pasted into a text field stays text, even if the clipboard holds a picture of it too. */
export function pastedImages(files: File[], text: string, inTextField: boolean) {
  if (inTextField && text.trim()) return [];
  return files.filter((file) => file.type.startsWith('image/'));
}

/** Enlarges an image that is too small for Daraz. Anything the browser cannot draw is sent as it is, for the backend to judge. */
export async function enlargeIfSmall(file: File): Promise<File> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  try {
    const size = enlargedSize(bitmap.width, bitmap.height);
    const context = size && Object.assign(document.createElement('canvas'), size).getContext('2d');
    if (!size || !context) return file;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    const blob = await new Promise<Blob | null>((resolve) => context.canvas.toBlob(resolve, 'image/png'));
    return blob ? new File([blob], file.name, { type: 'image/png' }) : file;
  } finally {
    bitmap.close();
  }
}
