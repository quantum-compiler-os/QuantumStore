import { describe, expect, it, vi } from 'vitest';
import { fetchCamshamImage, isCamshamImage, resizedCopies, toItem, typeOf, type WooCategory, type WooProduct } from '../api/_lib/camsham';
import { NoPicturesError } from '../src/features/audionic/syncOne';
import { camshamFallbackCategory, camshamSku, hostPictures, pictureCanvas, storeCategoryFor } from '../src/features/camsham/camsham';

const categories = new Map<number, WooCategory>(
  [
    { id: 62, name: 'Lenses', parent: 0 },
    { id: 63, name: 'Canon', parent: 62 },
    { id: 708, name: 'Accessories', parent: 0 },
    { id: 92, name: 'Batteries', parent: 708 },
    { id: 1008, name: 'Creators Special', parent: 0 },
    { id: 89, name: 'Camera &amp; Mobile Gimbals', parent: 0 },
  ].map((c) => [c.id, c]),
);

const product = (over: Partial<WooProduct> = {}): WooProduct => ({
  id: 20320,
  name: 'Canon RF 50mm f/1.8 STM Lens Price in Pakistan',
  type: 'simple',
  permalink: 'https://camsham.pk/store/canon-rf-50mm/',
  short_description: '<p><strong>Key Features</strong></p><ul><li>Focal Length: 50mm</li><li>Aperture: f/1.8</li></ul>',
  description:
    '<h2>Canon RF 50mm Price in Pakistan</h2><p>A compact and light prime lens that gives sharp portraits with soft backgrounds for every photographer.</p>',
  prices: { price: '3499900', currency_minor_unit: 2 },
  images: [
    { src: 'https://camsham.pk/wp-content/uploads/2026/01/rf50.webp', thumbnail: 'https://camsham.pk/wp-content/uploads/2026/01/rf50-600x720.webp' },
    { src: 'https://camsham.pk/wp-content/uploads/2026/01/rf50-side.jpg' },
  ],
  categories: [{ id: 63, name: 'Canon' }],
  brands: [{ name: '1 Year Warranty' }, { name: 'Canon' }],
  attributes: [],
  variations: [],
  is_in_stock: true,
  is_purchasable: true,
  ...over,
});

describe('the CamSham type', () => {
  it('comes from the top-level category when the product is only filed under a brand', () => {
    expect(typeOf(product(), categories)).toBe('Lenses');
  });

  it('prefers a sub-category that says what the product is', () => {
    expect(typeOf(product({ categories: [{ id: 1008, name: 'Creators Special' }, { id: 92, name: 'Batteries' }] }), categories)).toBe('Batteries');
  });

  it('reads HTML entities in category names', () => {
    expect(typeOf(product({ categories: [{ id: 89, name: 'Camera &amp; Mobile Gimbals' }] }), categories)).toBe('Gimbals');
  });

  it('falls back to the name for products only in marketing categories', () => {
    const only = { categories: [{ id: 1008, name: 'Creators Special' }] };
    expect(typeOf(product({ ...only, name: 'Godox TT520 III Flash with Cells &#038; Charger Bundle' }), categories)).toBe('Camera Flashes');
    expect(typeOf(product({ ...only, name: 'CAISI ST-77H Camera Tripod with Smartphone Holder' }), categories)).toBe('Tripods');
    expect(typeOf(product({ ...only, name: 'Helmet Chin Mount Phone Holder' }), categories)).toBe('Camera Accessories');
  });
});

describe('a CamSham product as an item', () => {
  const item = toItem(product(), 'Lenses')!;

  it('keeps CamSham\'s exact price in rupees', () => {
    expect(item.pkr).toBe(34999);
  });

  it('cleans the name and skips warranty terms filed as brands', () => {
    expect(item.name).toBe('Canon RF 50mm f/1.8 STM Lens');
    expect(item.brand).toBe('Canon');
    expect(toItem(product({ brands: [] }), 'Lenses')!.brand).toBe('No Brand');
  });

  it('keeps the pictures and turns key features into specs', () => {
    expect(item.image).toMatch(/rf50\.webp$/);
    expect(item.thumbnail).toMatch(/600x720/);
    expect(item.images).toHaveLength(1);
    expect(item.darazImages).toHaveLength(2);
    expect(item.specs).toEqual(expect.arrayContaining([{ key: 'Focal Length', value: '50mm' }]));
    expect(item.description).toMatch(/compact and light prime lens/);
    expect(item.description).not.toMatch(/Price in Pakistan/);
  });

  it('is sold out when CamSham cannot sell it', () => {
    expect(toItem(product({ is_in_stock: false }), 'Lenses')!.available).toBe(false);
    expect(toItem(product({ is_purchasable: false }), 'Lenses')!.available).toBe(false);
  });

  it('is skipped without a price or a picture', () => {
    expect(toItem(product({ prices: { price: '0', currency_minor_unit: 2 } }), 'Lenses')).toBeNull();
    expect(toItem(product({ images: [] }), 'Lenses')).toBeNull();
  });

  it('lists each option at its own price and starts from the lowest', () => {
    const variable = product({
      type: 'variable',
      variations: [
        { id: 1, attributes: [{ name: 'Storage', value: '64GB' }] },
        { id: 2, attributes: [{ name: 'Storage', value: '256GB' }] },
      ],
    });
    const options = toItem(variable, 'Memory Cards', [
      { id: 1, prices: { price: '699900', currency_minor_unit: 2 }, is_in_stock: false, is_purchasable: true },
      { id: 2, prices: { price: '879900', currency_minor_unit: 2 }, is_in_stock: true, is_purchasable: true },
    ])!;
    expect(options.variants).toEqual([
      { label: '64GB', pkr: 6999, available: false },
      { label: '256GB', pkr: 8799, available: true },
    ]);
    expect(options.pkr).toBe(6999);
    expect(options.available).toBe(true);
  });
});

describe('CamSham pictures', () => {
  it('only CamSham\'s upload folder can be fetched through the Launcher', () => {
    expect(isCamshamImage('https://camsham.pk/wp-content/uploads/2026/01/a.webp')).toBe(true);
    expect(isCamshamImage('http://camsham.pk/wp-content/uploads/a.webp')).toBe(false);
    expect(isCamshamImage('https://camsham.pk.evil.com/wp-content/uploads/a.webp')).toBe(false);
    expect(isCamshamImage('https://camsham.pk/wp-admin/secret')).toBe(false);
    expect(isCamshamImage('not a url')).toBe(false);
  });

  it('refuses anything else before fetching', async () => {
    const fetchImpl = vi.fn();
    await expect(fetchCamshamImage('https://example.com/a.jpg', fetchImpl as unknown as typeof fetch)).rejects.toThrow(/Only camsham\.pk/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('are copied to our storage, leaving out the ones that fail', async () => {
    const skipped: string[] = [];
    const pictures = await hostPictures(['https://c/a.webp', 'https://c/b.webp', 'https://c/c.webp'], {
      download: async (url) => {
        if (url.endsWith('b.webp')) throw new Error('404');
        return new Blob(['x'], { type: 'image/webp' });
      },
      upload: async (file) => ({ url: `https://drive/${file.name}.jpg`, thumbnail: `https://drive/${file.name}-thumb.webp` }),
      onSkip: (url) => skipped.push(url),
    });
    expect(pictures).toEqual({
      image: 'https://drive/a.webp.jpg',
      thumbnail: 'https://drive/a.webp-thumb.webp',
      images: ['https://drive/c.webp.jpg'],
      darazImages: ['https://drive/a.webp.jpg', 'https://drive/c.webp.jpg'],
    });
    expect(skipped).toEqual(['https://c/b.webp']);
  });

  it('too small for Daraz (under 330 px) are enlarged onto a white square', () => {
    expect(pictureCanvas(300, 300)).toEqual({ side: 600, width: 600, height: 600 });
    expect(pictureCanvas(800, 250)).toEqual({ side: 800, width: 800, height: 250 });
    expect(pictureCanvas(2400, 400)).toEqual({ side: 1200, width: 1200, height: 200 });
    expect(pictureCanvas(900, 900)).toBeNull();
    expect(pictureCanvas(2000, 1500)).toBeNull();
  });

  it('skip the product when not one picture works', async () => {
    const copying = hostPictures(['https://c/a.webp'], { download: async () => Promise.reject(new Error('404')), upload: vi.fn() });
    await expect(copying).rejects.toBeInstanceOf(NoPicturesError);
    await expect(copying).rejects.toThrow(/no working picture.*404/);
  });

  it('fall back to CamSham\'s resized copy when the full-size file is missing or broken', async () => {
    const tried: string[] = [];
    const pictures = await hostPictures(['https://c/z50.png'], {
      download: async (url) => {
        tried.push(url);
        if (url.endsWith('z50.png')) throw new Error('The source image could not be decoded.');
        return new Blob(['x'], { type: 'image/png' });
      },
      upload: async (file) => ({ url: `https://drive/${file.name}` }),
      copiesOf: () => ['https://c/z50-1024x683.png', 'https://c/z50-768x512.png'],
    });
    expect(tried).toEqual(['https://c/z50.png', 'https://c/z50-1024x683.png']);
    expect(pictures.image).toBe('https://drive/z50-1024x683.png');
  });

  it('are read with their resized copies, largest first and not too small', () => {
    const srcset =
      'https://c/z50.png 1030w, https://c/z50-300x200.png 300w, https://c/z50-1024x683.png 1024w, https://c/z50-768x512.png 768w, https://c/z50-150x100.png 150w';
    expect(resizedCopies({ src: 'https://c/z50.png', srcset })).toEqual([
      'https://c/z50-1024x683.png',
      'https://c/z50-768x512.png',
      'https://c/z50-300x200.png',
    ]);
    expect(resizedCopies({ src: 'https://c/a.jpg' })).toEqual([]);
  });
});

describe('CamSham on QuantumStore and Daraz', () => {
  it('uses the Daraz category name as the QuantumStore category', () => {
    expect(storeCategoryFor('Lenses', { path: 'Cameras › Camera Accessories › Lenses' })).toBe('Lenses');
    expect(storeCategoryFor('Tripods', { path: 'Cameras › Tripods & Monopods › Others' })).toBe('Tripods & Monopods');
    expect(storeCategoryFor('Tripods', null)).toBe('Tripods');
  });

  it('gives every CamSham product its own fixed SKU', () => {
    expect(camshamSku('20320')).toBe('CS-20320');
  });

  it('has a built-in Daraz category while the AI cannot answer, preferring the Cameras group', () => {
    const leaves = [
      { id: 1, name: 'Tripods', path: 'Mobiles & Tablets › Accessories › Tripods' },
      { id: 2, name: 'Tripods & Monopods', path: 'Cameras › Camera Accessories › Tripods & Monopods' },
    ];
    expect(camshamFallbackCategory('Tripods', leaves)?.id).toBe(2);
    expect(camshamFallbackCategory('Unknown type', leaves)).toBeNull();
  });
});

describe('hand-picked Daraz categories', () => {
  const paths = [
    'Cameras › Video & Action Camcorder › Sports & Action Camera',
    'Cameras › Camera Accessories › Batteries',
    'Cameras › Camera Accessories › Camera Cases, Covers and Bags',
    'Cameras › Camera Accessories › Camera Bags',
    'Cameras › Camera Accessories › Flashes',
    'Cameras › Camera Accessories › Camera Remote Controls',
    'Cameras › Camera Accessories › Straps',
    'Cameras › Camera Accessories › Tripods & Monopods › Tripods',
    'Cameras › Camera Accessories › Tripods & Monopods › Monopods',
    'Cameras › Mirrorless',
    'Cameras › DSLR',
    'Cameras › Lenses',
    'Cameras › Camera Accessories › Lens Caps',
    'Computers & Laptops › Storage › Flash Drives',
    'Computers & Laptops › Monitors',
  ];
  const leaves = paths.map((path, id) => ({ id, name: path.split(' › ').pop()!, path }));
  const pick = (type: string) => camshamFallbackCategory(type, leaves)?.path;

  it('files each type where a buyer would look for it, without asking the AI', () => {
    expect(pick('Cameras')).toBe('Cameras › Mirrorless'); // the AI had said Tripods
    expect(pick('Tripods')).toBe('Cameras › Camera Accessories › Tripods & Monopods › Tripods');
    expect(pick('Lenses')).toBe('Cameras › Lenses'); // not Lens Caps
    expect(pick('Action Cameras')).toBe('Cameras › Video & Action Camcorder › Sports & Action Camera');
    expect(pick('Camera Bags')).toBe('Cameras › Camera Accessories › Camera Bags');
    expect(pick('Camera Covers')).toBe('Cameras › Camera Accessories › Camera Cases, Covers and Bags');
    expect(pick('Camera Flashes')).toBe('Cameras › Camera Accessories › Flashes');
    expect(pick('Flash Drives')).toBe('Computers & Laptops › Storage › Flash Drives');
  });

  it('never leaves the Cameras group for a camera-only type', () => {
    expect(pick('Camera Monitors')).not.toBe('Computers & Laptops › Monitors');
  });
});
