import { describe, expect, it, vi } from 'vitest';
import { GENERAL_TYPE, fetchPakbooksItems, isPakbooksImage, languageOf, toItem, typeOf, type PakbooksProduct } from '../api/_lib/pakbooks';
import { pakbooksFallbackCategory, pakbooksSku } from '../src/features/pakbooks/pakbooks';
import { packageFromSpecs } from '../api/_lib/listingAi';
import { throttleWaitMs } from '../api/_lib/daraz';

describe('throttleWaitMs', () => {
  it("waits out Daraz's short throttle and nothing else", () => {
    expect(throttleWaitMs('Api access frequency exceeds the limit. this ban will last 1 seconds', 'ApiCallLimit')).toBe(2000);
    expect(throttleWaitMs('Api access frequency exceeds the limit.')).toBe(3000);
    expect(throttleWaitMs("You're not allowed to sell these keywords")).toBeNull();
  });
});

describe('packageFromSpecs', () => {
  it("builds a book-sized package from the product's own weight", () => {
    expect(packageFromSpecs([{ key: 'Weight', value: '805 g' }])).toEqual({ weight: 0.81, length: 22, width: 15, height: 4 });
    expect(packageFromSpecs([{ key: 'weight', value: '5.15 kg' }])).toEqual({ weight: 5.15, length: 22, width: 15, height: 22 });
  });

  it('gives nothing without a readable weight', () => {
    expect(packageFromSpecs([{ key: 'Author', value: 'Yasmin' }])).toBeNull();
    expect(packageFromSpecs([{ key: 'Weight', value: 'heavy' }])).toBeNull();
  });
});

const book = (over: Partial<PakbooksProduct> = {}): PakbooksProduct => ({
  id: 4663415111764,
  title: 'Tafsir As Sa`Di (Parts 1-2-3)',
  handle: 'tafsir-as-sa-di',
  body_html: '<p>A straightforward, easy to read explanation of the meaning of the Qur&rsquo;an.</p>',
  vendor: 'Shaikh Abdur-Rahman As-Saadi',
  tags: ['quran-tafaseer', 'islam'],
  variants: [{ title: 'Default Title', price: '4000.00', available: true, grams: 805 }],
  images: [{ src: 'https://cdn.shopify.com/s/files/1/0062/cover.png?v=1' }],
  ...over,
});

describe('isPakbooksImage', () => {
  it("only lets PakBooks' own pictures through", () => {
    expect(isPakbooksImage('https://cdn.shopify.com/s/files/1/0062/6468/4628/files/a.gif?v=1&width=1200&format=jpg')).toBe(true);
    expect(isPakbooksImage('https://www.pakbooks.com/cdn/shop/files/a.png')).toBe(true);
    expect(isPakbooksImage('https://cdn.shopify.com/s/files/1/9999/other-store/a.png')).toBe(false);
    expect(isPakbooksImage('http://cdn.shopify.com/s/files/1/0062/6468/4628/files/a.png')).toBe(false);
    expect(isPakbooksImage('https://evil.example/s/files/1/0062/6468/4628/a.png')).toBe(false);
  });
});

describe('typeOf', () => {
  it('takes the most specific tag', () => {
    expect(typeOf(['islam', 'quran-tafaseer'])).toBe('Quran & Tafseer');
    expect(typeOf(['best-sellers-urdu', 'fiction'])).toBe('Fiction');
  });

  it("trusts a title that plainly names a Quran, tafsir or hadith book over PakBooks' tags", () => {
    expect(typeOf([], 'Tafsir As Sa`Di (Parts 1-2-3)')).toBe('Quran & Tafseer');
    expect(typeOf(['fiction'], 'Quran e Kareem Kay Angrezi Trajum')).toBe('Quran & Tafseer');
    expect(typeOf([], 'Sahih Bukhari')).toBe('Hadith & Seerat');
    expect(typeOf(['fiction'], 'The Kite Runner')).toBe('Fiction');
  });

  it('files untagged and marketing-only books as general Books', () => {
    expect(typeOf([])).toBe(GENERAL_TYPE);
    expect(typeOf(['bundle-offers'])).toBe(GENERAL_TYPE);
  });
});

describe('languageOf', () => {
  it('tells Urdu from English, and says nothing for an empty text', () => {
    expect(languageOf('انطونیو توریس، برازیل کے عصر')).toBe('Urdu');
    expect(languageOf('An easy to read explanation')).toBe('English');
    expect(languageOf('  ')).toBeNull();
    // Empty HTML is not English.
    expect(languageOf('<p></p><br><span style="x"></span>')).toBeNull();
    expect(toItem(book({ body_html: '<p></p>' }))!.specs.some((s) => s.key === 'Language')).toBe(false);
  });
});

describe('toItem', () => {
  it('makes a listable book with the author, weight and language in the details', () => {
    const item = toItem(book())!;
    expect(item).toMatchObject({ pakbooksId: '4663415111764', pkr: 4000, available: true, type: 'Quran & Tafseer', author: 'Shaikh Abdur-Rahman As-Saadi' });
    expect(item.specs).toEqual(
      expect.arrayContaining([
        { key: 'Author', value: 'Shaikh Abdur-Rahman As-Saadi' },
        { key: 'Language', value: 'English' },
        { key: 'Weight', value: '805 g' },
      ]),
    );
    expect(item.darazImages[0]).toMatch(/format=jpg/);
    expect(item.variants).toEqual([]);
  });

  it('falls back to "<title> by <author>" when there is no description', () => {
    expect(toItem(book({ body_html: '' }))!.description).toBe('Tafsir As Sa`Di (Parts 1-2-3) by Shaikh Abdur-Rahman As-Saadi.');
  });

  it('skips a book with no price or no picture', () => {
    expect(toItem(book({ images: [] }))).toBeNull();
    expect(toItem(book({ variants: [{ title: 'Default Title', price: '0.00', available: true }] }))).toBeNull();
  });
});

describe('fetchPakbooksItems', () => {
  const page = (count: number, from = 0) => ({ products: Array.from({ length: count }, (_, i) => book({ id: from + i })) });
  const respond = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

  it('reads pages until one comes back short', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const n = Number(new URL(String(url)).searchParams.get('page'));
      return respond(n === 1 ? page(250) : n === 2 ? page(10, 250) : page(0));
    });
    const { items, fetched } = await fetchPakbooksItems(fetchImpl as typeof fetch);
    expect(fetched).toBe(260);
    expect(items).toHaveLength(260);
  });

  it('treats an empty catalog as an error', async () => {
    const fetchImpl = vi.fn(async () => respond({ products: [] }));
    await expect(fetchPakbooksItems(fetchImpl as typeof fetch)).rejects.toMatchObject({ status: 502 });
  });
});

describe('pakbooksFallbackCategory', () => {
  // Real paths from Daraz's tree.
  const leaf = (id: number, path: string) => ({ id, name: path.split(' › ').pop()!, path: `Media, Music & Books › Books › ${path}` });
  const leaves = [
    leaf(3377, 'Local Books › Literature'),
    leaf(3387, 'Local Books › Religion Books'),
    leaf(3396, 'Local Books › Entertainment Books'),
    leaf(3397, 'Local Books › Law Books'),
    leaf(3406, 'Local Books › Science Fiction Books'),
    leaf(7550, 'Local Books › Text books › High School'),
    leaf(3442, 'English Books › Literature'),
    leaf(3471, 'Chinese Books › Religion Books'),
  ];

  it('files fiction and untagged books under Literature, never Science Fiction or Law', () => {
    expect(pakbooksFallbackCategory('Fiction', leaves)?.id).toBe(3377);
    expect(pakbooksFallbackCategory('Books', leaves)?.id).toBe(3377);
  });

  it('uses Local Books, never the English or Chinese shelves', () => {
    expect(pakbooksFallbackCategory('Quran & Tafseer', leaves)?.id).toBe(3387);
    expect(pakbooksFallbackCategory('Textbooks', leaves)?.id).toBe(7550);
    expect(pakbooksFallbackCategory('Humour', leaves)?.id).toBe(3396);
  });

  it('falls back to Literature for a type with no category in the list', () => {
    expect(pakbooksFallbackCategory('Cooking', leaves)?.id).toBe(3377);
  });

  it('gives the same SKU every time', () => {
    expect(pakbooksSku('123')).toBe('PB-123');
  });
});
