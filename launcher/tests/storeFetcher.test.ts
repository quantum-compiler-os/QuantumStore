import { describe, expect, it } from 'vitest';
import { OTHER_TYPE, detectStore, fetchStoreImage, fetchStoreItems, storeOrigin, typeFromName, wooType } from '../api/_lib/storeFetcher';
import { MARKUP_PKR, shopHost, storeSku, withMarkup } from '../src/features/stores/storeFetcher';

const json = (data: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
const notFound = () => new Response('<html>not found</html>', { status: 404, headers: { 'content-type': 'text/html' } });

/** A fake shop: each request is answered by the first route whose text appears in the URL. */
function shop(routes: Array<[string, () => Response]>) {
  const asked: string[] = [];
  const fetchImpl = (async (input: string | URL) => {
    const url = String(input);
    asked.push(url);
    return routes.find(([part]) => url.includes(part))?.[1]() ?? notFound();
  }) as typeof fetch;
  return { fetchImpl, asked };
}

const shopifyProduct = (over: Record<string, unknown> = {}) => ({
  id: 7001,
  title: 'Wireless Mouse &amp; Pad',
  handle: 'wireless-mouse',
  body_html: '<p>A quiet wireless mouse with a long-lasting battery, a comfortable grip and a soft pad for your desk.</p>',
  product_type: 'Mice',
  vendor: 'Logi',
  published_at: null,
  variants: [
    { title: 'Black', price: '2500.00', available: true },
    { title: 'White', price: '2300.00', available: false },
  ],
  images: [{ src: '//cdn.shopify.com/s/files/1/0001/files/mouse.webp?v=1' }],
  ...over,
});

describe('shop address', () => {
  it('takes whatever is typed and keys the shop by its host without www', () => {
    expect(storeOrigin('example.pk')).toEqual({ origin: 'https://example.pk', host: 'example.pk' });
    expect(storeOrigin(' https://www.Example.pk/collections/all?page=2 ')).toEqual({ origin: 'https://www.example.pk', host: 'example.pk' });
    expect(storeOrigin('http://shop.example.pk')).toEqual({ origin: 'https://shop.example.pk', host: 'shop.example.pk' });
  });

  it('refuses this PC, the local network and things that are not addresses', () => {
    for (const bad of ['', 'localhost', 'http://localhost:5000', '192.168.1.10', 'http://[::1]/', 'printer.local', 'ftp://example.pk', 'nodot']) {
      expect(() => storeOrigin(bad), bad).toThrow();
    }
  });
});

describe('reading a Shopify shop', () => {
  it('detects it, takes its stated currency, and turns its products into items', async () => {
    const { fetchImpl } = shop([
      ['/meta.json', () => json({ currency: 'PKR' })],
      ['/products.json?limit=1', () => json({ products: [shopifyProduct()] })],
      [
        '/products.json?limit=250&page=1',
        () =>
          json({
            products: [
              shopifyProduct(),
              shopifyProduct({ id: 7002, title: 'Cable', product_type: '', vendor: '', variants: [{ title: 'Default Title', price: '400', available: true }] }),
              shopifyProduct({ id: 7003, title: 'No picture', images: [] }),
              shopifyProduct({ id: 7004, title: 'Free', variants: [{ title: 'Default Title', price: '0.00', available: true }] }),
            ],
          }),
      ],
      // Pages past the end (read side by side with page 1) are empty, as on Shopify.
      ['/products.json?limit=250', () => json({ products: [] })],
    ]);
    const { store, items, fetched } = await fetchStoreItems('www.example.pk', fetchImpl);
    expect(store).toEqual({ origin: 'https://www.example.pk', host: 'example.pk', platform: 'shopify', currency: 'PKR' });
    expect(fetched).toBe(4);
    expect(items.map((i) => i.id)).toEqual(['example.pk/7001', 'example.pk/7002']);

    const [mouse, cable] = items;
    expect(mouse).toMatchObject({
      name: 'Wireless Mouse & Pad',
      brand: 'Logi',
      type: 'Mice',
      url: 'https://www.example.pk/products/wireless-mouse',
      pkr: 2300,
      available: true,
      variants: [
        { label: 'Black', pkr: 2500, available: true },
        { label: 'White', pkr: 2300, available: false },
      ],
    });
    expect(mouse.darazImages[0]).toMatch(/^https:\/\/cdn\.shopify\.com\/.*width=1200.*format=jpg/);
    // No product type from the shop: typed from its name.
    expect(cable).toMatchObject({ type: 'Cables', brand: 'No Brand', pkr: 400, variants: [] });
  });

  it('groups products the shop gave no type by the product word in their name', () => {
    expect(typeFromName('Airbuds 595 Flip Earbuds')).toBe('Earbuds');
    expect(typeFromName('Orchestra Pro Dolby Audio Sound Bar with Wireless Woofer 5.1 Ch')).toBe('Sound Bars');
    expect(typeFromName('Max 230 Bluetooth Speaker')).toBe('Speakers');
    expect(typeFromName('Type-C to Lightning Cable 1m')).toBe('Cables');
    expect(typeFromName('Gift Voucher')).toBe(OTHER_TYPE);
  });

  it('refuses a shop that prices in another currency', async () => {
    const { fetchImpl } = shop([
      ['/meta.json', () => json({ currency: 'USD' })],
      ['/products.json', () => json({ products: [] })],
    ]);
    await expect(detectStore('example.com', fetchImpl)).rejects.toThrow(/USD, not rupees/);
  });

  it('takes rupees when the shop does not say its currency', async () => {
    const { fetchImpl } = shop([['/products.json', () => json({ products: [] })]]);
    await expect(detectStore('example.pk', fetchImpl)).resolves.toMatchObject({ platform: 'shopify', currency: null });
  });
});

describe('reading a WooCommerce shop', () => {
  const price = (rupees: number) => ({ price: String(rupees * 100), currency_minor_unit: 2, currency_code: 'PKR' });
  const wooProduct = (over: Record<string, unknown> = {}) => ({
    id: 55,
    name: 'Ring Light 18 inch Price in Pakistan',
    type: 'simple',
    permalink: 'https://woo.pk/product/ring-light',
    short_description: '<p>A bright 18 inch ring light with a stand, a phone holder and three colour modes for videos.</p>',
    description: '',
    prices: price(6000),
    images: [{ src: 'https://woo.pk/wp-content/uploads/ring.jpg', srcset: 'https://woo.pk/wp-content/uploads/ring-600x600.jpg 600w' }],
    categories: [
      { id: 1, name: 'Lighting' },
      { id: 2, name: 'Ring Lights' },
    ],
    attributes: [],
    variations: [],
    is_in_stock: true,
    is_purchasable: true,
    ...over,
  });

  it('detects it, types products by their deepest category and reads option prices', async () => {
    // Routes match by text, so the full catalog (per_page=100) is listed before the one-product probe (per_page=1).
    const { fetchImpl } = shop([
      ['/products.json', () => notFound()],
      [
        '/products/categories?',
        () =>
          json([
            { id: 1, name: 'Lighting', parent: 0 },
            { id: 2, name: 'Ring Lights', parent: 1 },
          ]),
      ],
      ['/products?type=variation', () => json([{ id: 91, prices: price(1500), is_in_stock: true, is_purchasable: true }])],
      [
        '/products?per_page=100',
        () =>
          json(
            [
              wooProduct(),
              wooProduct({ id: 56, name: 'Tripod', categories: [{ id: 9, name: 'Uncategorized' }], prices: price(0), variations: [{ id: 91, attributes: [{ name: 'Size', value: '7 ft' }] }] }),
            ],
            { 'x-wp-totalpages': '1' },
          ),
      ],
      ['/products?per_page=1', () => json([wooProduct()])],
    ]);
    const { store, items } = await fetchStoreItems('https://woo.pk', fetchImpl);
    expect(store).toMatchObject({ platform: 'woocommerce', currency: 'PKR', host: 'woo.pk' });
    expect(items[0]).toMatchObject({ id: 'woo.pk/55', name: 'Ring Light 18 inch', type: 'Ring Lights', pkr: 6000, brand: 'No Brand' });
    expect(items[0].pictureCopies).toEqual({ 'https://woo.pk/wp-content/uploads/ring.jpg': ['https://woo.pk/wp-content/uploads/ring-600x600.jpg'] });
    // Only "Uncategorized": typed from its name.
    expect(items[1]).toMatchObject({ id: 'woo.pk/56', type: 'Tripods', pkr: 1500, variants: [{ label: '7 ft', pkr: 1500, available: true }] });
  });

  it('picks the deepest category whatever order the shop lists them in', () => {
    const categories = new Map([
      [1, { id: 1, name: 'Audio', parent: 0 }],
      [2, { id: 2, name: 'Earbuds', parent: 1 }],
    ]);
    expect(wooType({ categories: [{ id: 2, name: 'Earbuds' }, { id: 1, name: 'Audio' }] }, categories)).toBe('Earbuds');
    expect(wooType({ categories: [] }, categories)).toBe(OTHER_TYPE);
  });

  it('explains when a site is neither kind of shop', async () => {
    const { fetchImpl } = shop([]);
    await expect(detectStore('example.org', fetchImpl)).rejects.toThrow(/does not share a product list/);
  });
});

describe('pictures', () => {
  it('are only fetched from the public internet, and must be pictures', async () => {
    const { fetchImpl } = shop([
      ['/ok.jpg', () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } })],
      ['/page', () => new Response('<html/>', { headers: { 'content-type': 'text/html' } })],
    ]);
    await expect(fetchStoreImage('https://cdn.example.pk/ok.jpg', fetchImpl)).resolves.toMatchObject({ type: 'image/jpeg' });
    await expect(fetchStoreImage('https://example.pk/page', fetchImpl)).rejects.toThrow(/did not return a picture/);
    await expect(fetchStoreImage('https://localhost/ok.jpg', fetchImpl)).rejects.toThrow(/public internet/);
    await expect(fetchStoreImage('http://example.pk/ok.jpg', fetchImpl)).rejects.toThrow(/public internet/);
  });
});

describe('our price and SKU', () => {
  it(`adds Rs ${MARKUP_PKR} to the product and every option, and keeps the shop's price`, () => {
    const item = {
      id: 'example.pk/1',
      pkr: 2300,
      variants: [
        { label: 'Black', pkr: 2500, available: true },
        { label: 'White', pkr: 2300, available: false },
      ],
    } as Parameters<typeof withMarkup>[0];
    const priced = withMarkup(item);
    expect(priced.pkr).toBe(2800);
    expect(priced.shopPkr).toBe(2300);
    expect(priced.variants.map((v) => v.pkr)).toEqual([3000, 2800]);
    expect(item.pkr).toBe(2300); // the shop's item is not changed
  });

  it('gives each shop product its own stable Daraz SKU', () => {
    expect(storeSku('example.pk/7001')).toBe('SF-EXAMPLEPK-7001');
    expect(storeSku('my-very-long-shop-name.com.pk/55')).toBe('SF-MYVERYLONG-55');
  });

  it('keys a typed address the same way the server does', () => {
    expect(shopHost('https://www.Example.pk/shop')).toBe('example.pk');
    expect(shopHost('example.pk')).toBe('example.pk');
    expect(shopHost('')).toBe('');
  });
});
