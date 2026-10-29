import { describe, expect, it } from 'vitest';
import { signState, verifyState } from '../api/_lib/auth';
import {
  NO_BRAND,
  isRejectedValue,
  resolveBrand,
  buildImageMigrateXml,
  buildProductXml,
  buildSetImagesXml,
  removeProductAttempts,
  describeDarazError,
  extractAuthCode,
  flattenCategoryTree,
  normalizeAttributes,
  signRequest,
  type DarazProductInput,
} from '../api/_lib/darazCore';

describe('signRequest', () => {
  it('matches an independently computed HMAC-SHA256 (openssl) over path + sorted key/value pairs', () => {
    // Deliberately unsorted input: the signer must sort keys itself.
    const sign = signRequest(
      '/auth/token/create',
      { timestamp: '1517820392000', code: 'abc', sign_method: 'sha256', app_key: '123' },
      'helloworld',
    );
    expect(sign).toBe('22E89F1A3086DFB65BDFA6E215A609BCB738D98C240F9DD16B15689F4F14BAD5');
  });

  it('changes when any value changes', () => {
    const a = signRequest('/x', { a: '1' }, 's');
    expect(signRequest('/x', { a: '2' }, 's')).not.toBe(a);
    expect(signRequest('/y', { a: '1' }, 's')).not.toBe(a);
    expect(signRequest('/x', { a: '1' }, 't')).not.toBe(a);
  });
});

const base: DarazProductInput = {
  categoryId: 4023,
  name: 'Pro <Buds> & Case',
  description: 'Line one\nLine "two"',
  brand: 'Audionic',
  sellerSku: 'PRO-BUDS-1A2B',
  quantity: 5,
  price: 4999,
  specialPrice: null,
  images: ['https://pk-live.slatic.net/p/1.jpg'],
  package: { weight: 0.3, length: 12, width: 8, height: 5, content: 'Buds + case' },
  attributes: { warranty_type: 'Local seller warranty', color_family: 'Black', empty: '' },
};

describe('buildProductXml', () => {
  const xml = buildProductXml(base, normalizeAttributes([{ name: 'color_family', attribute_type: 'sku' }]));

  it('escapes user text and places it in the right sections', () => {
    expect(xml).toContain('<name>Pro &lt;Buds&gt; &amp; Case</name>');
    expect(xml).toContain('<PrimaryCategory>4023</PrimaryCategory>');
    expect(xml).toContain('<description><![CDATA[Line one<br/>Line "two"]]></description>');
  });

  it('puts sku-typed attributes inside <Sku> and normal ones inside <Attributes>', () => {
    const attributes = xml.slice(xml.indexOf('<Attributes>'), xml.indexOf('</Attributes>'));
    const sku = xml.slice(xml.indexOf('<Sku>'), xml.indexOf('</Sku>'));
    expect(attributes).toContain('<warranty_type>Local seller warranty</warranty_type>');
    expect(attributes).not.toContain('color_family');
    expect(sku).toContain('<color_family>Black</color_family>');
    expect(sku).toContain('<SellerSku>PRO-BUDS-1A2B</SellerSku>');
    expect(sku).toContain('<price>4999.00</price>');
    expect(sku).toContain('<package_weight>0.3</package_weight>');
  });

  it('skips blank attributes and only sends a special price that undercuts the price', () => {
    expect(xml).not.toContain('<empty>');
    expect(xml).not.toContain('special_price');
    const cheaper = buildProductXml({ ...base, specialPrice: 4500 });
    expect(cheaper).toContain('<special_price>4500.00</special_price>');
    const dearer = buildProductXml({ ...base, specialPrice: 6000 });
    expect(dearer).not.toContain('special_price');
  });

  it('refuses attribute names that could inject markup', () => {
    expect(() => buildProductXml({ ...base, attributes: { 'x><evil': 'y' } })).toThrow(/Invalid Daraz attribute/);
  });
});

describe('other helpers', () => {
  it('escapes the migrate URL', () => {
    expect(buildImageMigrateXml('https://a.com/i.jpg?x=1&y=2')).toContain('<Url>https://a.com/i.jpg?x=1&amp;y=2</Url>');
  });

  it('flattens the category tree to leaves with breadcrumb paths', () => {
    const leaves = flattenCategoryTree([
      {
        category_id: 1,
        name: 'Electronics',
        children: [
          { category_id: 2, name: 'Audio', children: [{ category_id: 3, name: 'Earbuds', leaf: true }] },
          { category_id: 4, name: 'Cables', leaf: true },
        ],
      },
    ]);
    expect(leaves).toEqual([
      { id: 3, name: 'Earbuds', path: 'Electronics › Audio › Earbuds' },
      { id: 4, name: 'Cables', path: 'Electronics › Cables' },
    ]);
  });

  it('normalizes mandatory flags and options', () => {
    const [a, b] = normalizeAttributes([
      { name: 'brand', is_mandatory: 1, options: [{ name: 'Audionic' }] },
      { name: 'model', is_mandatory: 0, attribute_type: 'sku' },
    ]);
    expect(a).toMatchObject({ mandatory: true, attributeType: 'normal', options: ['Audionic'] });
    expect(b).toMatchObject({ mandatory: false, attributeType: 'sku' });
  });

  it('describes a Daraz error with its field detail', () => {
    expect(
      describeDarazError({ code: '500', message: 'Invalid product', detail: [{ field: 'brand', message: 'required' }] }),
    ).toBe('Invalid product — brand: required');
  });
});

describe('OAuth state', () => {
  it('accepts a fresh state and rejects tampered, stale and foreign ones', () => {
    const now = 1_700_000_000_000;
    const state = signState('secret', now);
    expect(verifyState(state, 'secret', now + 1000)).toBe(true);
    expect(verifyState(state, 'other', now + 1000)).toBe(false);
    expect(verifyState(state, 'secret', now + 11 * 60 * 1000)).toBe(false);
    expect(verifyState(`${now}.deadbeef`, 'secret', now + 1000)).toBe(false);
    expect(verifyState('', 'secret', now)).toBe(false);
  });
});

describe('extractAuthCode', () => {
  it('takes a bare code or the code out of a pasted redirect address', () => {
    expect(extractAuthCode('0_506344_AbC123xyz')).toBe('0_506344_AbC123xyz');
    expect(extractAuthCode('  0_506344_AbC123xyz\n')).toBe('0_506344_AbC123xyz');
    expect(extractAuthCode('https://catcher.example.com/?code=0_506344_AbC123xyz&state=1')).toBe('0_506344_AbC123xyz');
    expect(extractAuthCode('https://x.test/cb?foo=1&code=0%5F506344%5FAbC#frag')).toBe('0_506344_AbC');
  });

  it('rejects empty input and anything that is not code-shaped', () => {
    expect(extractAuthCode('')).toBeNull();
    expect(extractAuthCode('   ')).toBeNull();
    expect(extractAuthCode('hello world')).toBeNull();
    expect(extractAuthCode('https://x.test/cb?error=denied')).toBeNull();
    expect(extractAuthCode('<script>alert(1)</script>')).toBeNull();
  });
});

describe('brands', () => {
  it('keeps a brand that is on the category list, using the list spelling', () => {
    expect(resolveBrand('samsung', ['Apple', 'Samsung'])).toBe('Samsung');
  });

  it('falls back to No Brand for an unknown or empty brand', () => {
    expect(resolveBrand('Zia ul Quran', ['Apple', 'Samsung'])).toBe(NO_BRAND);
    expect(resolveBrand('  ', ['Apple'])).toBe(NO_BRAND);
  });

  it('passes the brand through when Daraz gave no list', () => {
    expect(resolveBrand('Zia ul Quran')).toBe('Zia ul Quran');
  });

  it('recognises the dropdown error that names the brand', () => {
    const message = 'E500: Create product failed — p-20000: C011:value not in the dropdown list Zia ul Quran[-1]';
    expect(isRejectedValue(message, 'Zia ul Quran')).toBe(true);
    expect(isRejectedValue(message, 'Samsung')).toBe(false);
    expect(isRejectedValue(message, '')).toBe(false);
  });
});

describe('buildSetImagesXml', () => {
  it('lists the new images under the SKU and escapes the values', () => {
    const xml = buildSetImagesXml('12345', ['https://img.example/a.jpg', 'https://img.example/b.jpg?x=1&y=2']);
    expect(xml).toContain('<Skus><Sku><SkuId>12345</SkuId><Images>');
    expect(xml).not.toContain('SellerSku');
    expect(xml).toContain('<Image>https://img.example/a.jpg</Image>');
    expect(xml).toContain('<Image>https://img.example/b.jpg?x=1&amp;y=2</Image>');
  });
});

describe('description cover image', () => {
  const input: DarazProductInput = {
    categoryId: 1,
    name: 'Book',
    description: 'A book about maths.',
    brand: 'No Brand',
    sellerSku: 'B-1',
    quantity: 3,
    price: 500,
    images: ['https://img.example/a.jpg'],
    package: { weight: 0.5, length: 24, width: 17, height: 2, content: 'Book' },
    attributes: {},
  };

  it('puts the cover image above the description text', () => {
    const xml = buildProductXml({ ...input, descriptionImage: 'https://img.example/a.jpg?x=1&y=2' });
    expect(xml).toContain(
      '<description><![CDATA[<p><img src="https://img.example/a.jpg?x=1&amp;y=2" style="max-width:100%"/></p>A book about maths.]]></description>',
    );
  });

  it('leaves the description as it is without a cover image', () => {
    expect(buildProductXml(input)).toContain('<description><![CDATA[A book about maths.]]></description>');
  });
});

describe('removeProductAttempts', () => {
  it('tries the SKU id first and the seller SKU second', () => {
    expect(removeProductAttempts({ itemId: '111', skuId: '222', sellerSku: 'BOOK-1' })).toEqual([
      { sku_id_list: '["SkuId_111_222"]' },
      { seller_sku_list: '["BOOK-1"]' },
    ]);
  });

  it('only has the seller SKU when the SKU id is unknown', () => {
    expect(removeProductAttempts({ itemId: '111', skuId: '', sellerSku: 'BOOK-1' })).toEqual([
      { seller_sku_list: '["BOOK-1"]' },
    ]);
  });
});
