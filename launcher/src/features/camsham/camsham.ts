import type { DarazCategoryLeaf } from '../../api/daraz';
import { PATH_SEPARATOR, filterLeaves } from '../daraz/categoryGroups';
import type { Pictures } from '../audionic/syncOne';

/** The same SKU every time for the same CamSham product, so Daraz rejects a duplicate instead of listing it twice. */
export const camshamSku = (camshamId: string) => `CS-${camshamId}`;

/**
 * The QuantumStore category for a product: the name of the Daraz category chosen for its type, so both shops file it
 * the same way. "Cameras › Lenses › Others" gives "Lenses" (an "Others" leaf says nothing on its own). Without a Daraz
 * category the product's CamSham type is used.
 */
export function storeCategoryFor(type: string, daraz: { path: string } | null) {
  if (!daraz) return type;
  const parts = daraz.path.split(PATH_SEPARATOR).map((p) => p.trim()).filter(Boolean);
  let name = parts.pop() || type;
  while (/^others?$/i.test(name) && parts.length) name = parts.pop() as string;
  return /^others?$/i.test(name) ? type : name;
}

/** Daraz refuses pictures under 330×330 px; small ones are enlarged onto a square at least this big. */
const MIN_PICTURE_SIDE = 600;
/** The backend keeps pictures at most this wide. */
const MAX_PICTURE_WIDTH = 1200;

/**
 * The white square a picture is placed on so Daraz accepts it, or null when it is already fine. A square keeps a wide
 * picture tall enough after the backend narrows it to 1200 px. The picture is scaled up to fill the square's longer side.
 */
export function pictureCanvas(width: number, height: number): { side: number; width: number; height: number } | null {
  const shownHeight = width > MAX_PICTURE_WIDTH ? (height * MAX_PICTURE_WIDTH) / width : height;
  if (Math.min(width, MAX_PICTURE_WIDTH) >= MIN_PICTURE_SIDE && shownHeight >= MIN_PICTURE_SIDE) return null;
  const side = Math.min(MAX_PICTURE_WIDTH, Math.max(MIN_PICTURE_SIDE, width, height));
  const scale = side / Math.max(width, height);
  return { side, width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** Enlarges a picture too small for Daraz onto a centred white square (browser only); other pictures are returned as they are. */
export async function fitPictureForDaraz(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const target = pictureCanvas(bitmap.width, bitmap.height);
  if (!target) {
    bitmap.close();
    return blob;
  }
  const canvas = document.createElement('canvas');
  canvas.width = target.side;
  canvas.height = target.side;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot enlarge pictures');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, target.side, target.side);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, (target.side - target.width) / 2, (target.side - target.height) / 2, target.width, target.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((out) => (out ? resolve(out) : reject(new Error('Could not enlarge the picture'))), 'image/jpeg', 0.92),
  );
}

type Copy = { url: string; thumbnail?: string };

/**
 * Copies a CamSham product's pictures to QuantumStore's storage (the backend turns them into JPEG, which Daraz needs;
 * CamSham serves many as webp). A picture that cannot be copied is left out and reported; with none left it fails.
 */
export async function hostPictures(
  sources: string[],
  deps: { download: (url: string) => Promise<Blob>; upload: (file: File) => Promise<Copy>; onSkip?: (url: string, reason: string) => void },
): Promise<Pictures> {
  const copies: Copy[] = [];
  let lastError = '';
  for (const url of sources) {
    try {
      const blob = await deps.download(url);
      const name = url.split('/').pop()?.split('?')[0] || 'camsham-image';
      copies.push(await deps.upload(new File([blob], name, { type: blob.type || 'image/jpeg' })));
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      deps.onSkip?.(url, lastError);
    }
  }
  if (!copies.length) throw new Error(`Could not copy any picture from camsham.pk${lastError ? ` (${lastError})` : ''}`);
  const [cover, ...rest] = copies;
  return {
    image: cover.url,
    thumbnail: cover.thumbnail || cover.url,
    images: rest.map((c) => c.url),
    darazImages: copies.map((c) => c.url),
  };
}

const CAMERAS = 'Cameras';

/** A word search in Daraz's category paths: inside the Cameras group unless `anywhere` is set. */
type Rule = { q: string; anywhere?: true };
const any = (q: string): Rule => ({ q, anywhere: true });

// The Daraz category for each CamSham type, chosen by hand (no AI needed). Rules are tried in order; the first that finds
// a category wins. The paths in the comments are Daraz's, e.g. "Cameras › Camera Accessories › Tripods & Monopods › Tripods".
// The result is shown in the picker on the CamSham page and can still be changed there.
const RULES: Record<string, Rule[]> = {
  Cameras: [{ q: 'mirrorless' }, { q: 'dslr' }, { q: 'point shoot' }],
  'Action Cameras': [{ q: 'sports action camera' }, { q: 'action camera' }],
  Drones: [{ q: 'drones' }, any('drones')],
  Lenses: [{ q: 'lenses' }],
  'Lens Adaptors': [{ q: 'lens adapter' }, { q: 'adapter' }, { q: 'lenses' }],
  'Lens Filters': [{ q: 'filters' }, { q: 'filter' }],
  'Lens Hoods': [{ q: 'lens hood' }, { q: 'lens caps' }, { q: 'camera accessories others' }],
  'Camera Flashes': [{ q: 'flashes' }, { q: 'flash' }],
  'Flash Triggers': [{ q: 'flash' }, { q: 'remote controls' }],
  Lighting: [{ q: 'lighting' }, { q: 'studio' }, { q: 'flash' }],
  'Studio Lights': [{ q: 'lighting' }, { q: 'studio' }, { q: 'flash' }],
  'Ring Lights': [{ q: 'ring light' }, any('ring light'), { q: 'lighting' }],
  'Softboxes & Umbrellas': [{ q: 'softbox' }, { q: 'studio' }, { q: 'lighting' }],
  Tripods: [{ q: 'tripods' }, { q: 'tripod' }],
  Gimbals: [{ q: 'gimbal' }, { q: 'stabilizer' }, any('gimbal')],
  'Camera Bags': [{ q: 'camera bags' }, { q: 'bags' }],
  'Camera Covers': [{ q: 'camera cases covers' }, { q: 'cases' }],
  'Camera Straps': [{ q: 'straps' }, { q: 'strap' }],
  Batteries: [{ q: 'batteries' }, { q: 'battery' }],
  Chargers: [{ q: 'chargers' }, { q: 'charger' }],
  'Memory Cards': [{ q: 'memory cards' }, any('memory cards'), any('memory card')],
  'Memory Card Cases': [{ q: 'memory card' }, { q: 'camera cases covers' }],
  'Card Readers': [any('card readers'), any('card reader')],
  'Flash Drives': [any('flash drives'), any('flash drive')],
  'Hard Drives': [any('external hard drives'), any('external hard'), any('hard drives')],
  Microphones: [{ q: 'microphones' }, { q: 'microphone' }, any('microphones'), any('microphone')],
  'Camera Monitors': [{ q: 'monitor' }, { q: 'camera accessories others' }],
  'Power Banks': [any('power banks'), any('power bank')],
  'Mobile Accessories': [any('power banks'), any('power bank')],
  'Camera Accessories': [{ q: 'camera accessories others' }, { q: 'camera accessories' }],
};

const words = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** How well a category's own name (its last level) matches the search: "Tripods" for "tripods" beats "Tripod Heads". */
function nameScore(leaf: DarazCategoryLeaf, q: string) {
  const name = words(leaf.path.split(PATH_SEPARATOR).pop() || leaf.name);
  const query = words(q);
  if (name === query || name === `${query}s`) return 3;
  if (name.startsWith(query)) return 2;
  return name.includes(query) ? 1 : 0;
}

export function camshamFallbackCategory(type: string, leaves: DarazCategoryLeaf[]): DarazCategoryLeaf | null {
  for (const rule of RULES[type] ?? []) {
    const hits = filterLeaves(leaves, rule.anywhere ? '' : CAMERAS, rule.q, leaves.length);
    if (!hits.length) continue;
    return hits.reduce((best, leaf) => {
      const diff = nameScore(leaf, rule.q) - nameScore(best, rule.q);
      return diff > 0 || (diff === 0 && leaf.path.length < best.path.length) ? leaf : best;
    });
  }
  return null;
}
