import { describe, expect, it, vi } from 'vitest';
import { fetchAudionicItems, parseProductDescription, sizedImage, toItem } from '../api/_lib/audionic';

const earbuds = {
  id: 101,
  title: 'Airbud Test Earbuds',
  handle: 'airbud-test',
  product_type: 'Wireless Earbuds',
  published_at: '2026-09-01T10:00:00+05:00',
  body_html:
    '<p><strong>Connectivity</strong></p><ul><li>BT 5.4</li><li>USB-C Charging</li></ul>' +
    '<p><b>FAQs</b></p><p><b>Can I use one earbud?</b></p><p>Yes, you can.</p>',
  variants: [
    { title: 'Black', price: '3499.00', available: true },
    { title: 'White', price: '3499.00', available: false },
  ],
  images: [{ src: 'https://cdn.shopify.com/s/files/1/airbud.webp?v=1' }, { src: 'https://cdn.shopify.com/s/files/1/airbud2.webp?v=1' }],
};

const placeholder = {
  id: 102,
  title: 'Placeholder Speaker',
  handle: 'placeholder-speaker',
  product_type: '',
  published_at: null,
  body_html: '',
  variants: [{ title: 'Default Title', price: '0.00', available: false }],
  images: [{ src: 'https://cdn.shopify.com/s/files/1/speaker.webp?v=1' }],
};

const powerBank = {
  id: 103,
  title: 'Mystery Gadget 20000',
  handle: 'mystery',
  product_type: '',
  published_at: null,
  body_html: '',
  variants: [{ title: 'Default Title', price: '5000.00', available: true }],
  images: [{ src: 'https://cdn.shopify.com/s/files/1/m.webp' }],
};

/** A fetch stub: the main feed returns `feed`, collection feeds return `collections[handle]`. */
function stubFeed(feed: unknown[], collections: Record<string, unknown[]> = {}) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    const handle = /\/collections\/([^/]+)\/products\.json/.exec(url)?.[1];
    const products = handle ? (collections[handle] ?? []) : url.startsWith('https://audionic.co/products.json') ? feed : [];
    return new Response(JSON.stringify({ products }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
}

describe('fetchAudionicItems', () => {
  it('lists the products at Audionic\'s exact price, with the Rs 0 placeholder skipped', async () => {
    const { items, fetched } = await fetchAudionicItems(stubFeed([earbuds, placeholder]));
    expect(fetched).toBe(2);
    expect(items).toHaveLength(1);
    const [item] = items;
    // No deduction: Rs 3,499 on audionic.co is Rs 3,499 here.
    expect(item.pkr).toBe(3499);
    expect(item.variants).toEqual([
      { label: 'Black', pkr: 3499, available: true },
      { label: 'White', pkr: 3499, available: false },
    ]);
    expect(item).toMatchObject({
      audionicId: '101',
      type: 'Earbuds',
      storeCategory: 'Audio',
      available: true,
      url: 'https://audionic.co/products/airbud-test',
      specs: [{ key: 'Connectivity', value: 'BT 5.4, USB-C Charging' }],
      description: 'Airbud Test Earbuds by Audionic.',
      publishedAt: '2026-09-01T10:00:00+05:00',
    });
  });

  it('sizes the store pictures and asks Shopify for JPEGs for Daraz', async () => {
    const [item] = (await fetchAudionicItems(stubFeed([earbuds]))).items;
    expect(item.image).toBe('https://cdn.shopify.com/s/files/1/airbud.webp?v=1&width=1200');
    expect(item.thumbnail).toMatch(/width=400/);
    expect(item.images).toEqual(['https://cdn.shopify.com/s/files/1/airbud2.webp?v=1&width=1200']);
    expect(item.darazImages).toHaveLength(2);
    for (const url of item.darazImages) expect(url).toMatch(/width=1200.*format=jpg|format=jpg.*width=1200/);
    expect(sizedImage('//cdn.shopify.com/x.webp', 400)).toBe('https://cdn.shopify.com/x.webp?width=400');
  });

  it('falls back to Audionic\'s collections for products whose name says nothing', async () => {
    const { items } = await fetchAudionicItems(stubFeed([powerBank], { 'power-bank': [powerBank] }));
    expect(items[0]).toMatchObject({ type: 'Power Banks', storeCategory: 'Accessories' });
  });

  it('files an unclassifiable product under Accessories', async () => {
    const { items } = await fetchAudionicItems(stubFeed([powerBank]));
    expect(items[0]).toMatchObject({ type: 'Accessories', storeCategory: 'Accessories' });
  });

  it('keeps a product with a single Default Title variant free of variants', async () => {
    const { items } = await fetchAudionicItems(stubFeed([powerBank]));
    expect(items[0].variants).toEqual([]);
    expect(items[0].pkr).toBe(5000);
  });

  it('refuses an empty catalog instead of treating it as "everything was removed"', async () => {
    await expect(fetchAudionicItems(stubFeed([placeholder]))).rejects.toMatchObject({ status: 502 });
    await expect(fetchAudionicItems(stubFeed([]))).rejects.toThrow(/no products/);
  });

  it('reports audionic.co being unreachable or erroring', async () => {
    const down = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    await expect(fetchAudionicItems(down)).rejects.toThrow(/Could not reach audionic\.co/);
    const broken = vi.fn(async () => new Response('', { status: 503 })) as unknown as typeof fetch;
    await expect(fetchAudionicItems(broken)).rejects.toThrow(/responded with 503/);
  });
});

describe('toItem', () => {
  const kind = { type: 'Earbuds', category: 'Audio' };

  it('skips a product with no picture or no price above Rs 0', () => {
    expect(toItem({ ...earbuds, images: [] }, kind)).toBeNull();
    expect(toItem(placeholder, kind)).toBeNull();
  });

  it('takes the lowest listed price and marks an item sold out when no variant is available', () => {
    const soldOut = {
      ...earbuds,
      variants: [
        { title: 'Black', price: '4000', available: false },
        { title: 'White', price: '3800', available: false },
      ],
    };
    expect(toItem(soldOut, kind)).toMatchObject({ pkr: 3800, available: false });
  });

  it('keeps at most eight pictures', () => {
    const many = { ...earbuds, images: Array.from({ length: 12 }, (_, i) => ({ src: `https://cdn.shopify.com/${i}.jpg` })) };
    const item = toItem(many, kind);
    expect(item?.images).toHaveLength(7);
    expect(item?.darazImages).toHaveLength(8);
  });
});

describe('parseProductDescription', () => {
  it('turns "bold heading + bullets" into specs and drops the FAQ', () => {
    const { description, specs } = parseProductDescription(earbuds.body_html, earbuds.title);
    expect(specs).toEqual([{ key: 'Connectivity', value: 'BT 5.4, USB-C Charging' }]);
    expect(description).toBe('');
  });

  it('reads table rows and key: value lines, and keeps real prose only', () => {
    const html =
      '<p>This speaker fills a whole room with deep bass and clear vocals for every kind of music you play.</p>' +
      '<table><tr><td>Power</td><td>40W</td></tr></table><p>Battery: 4000 mAh</p>' +
      '<p>Buy now at the lowest price in Pakistan with fast shipping.</p>';
    const { description, specs } = parseProductDescription(html, 'Max Speaker');
    expect(specs).toEqual([
      { key: 'Power', value: '40W' },
      { key: 'Battery', value: '4000 mAh' },
    ]);
    expect(description).toBe('This speaker fills a whole room with deep bass and clear vocals for every kind of music you play.');
  });
});
