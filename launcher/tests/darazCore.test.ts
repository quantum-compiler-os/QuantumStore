import { describe, expect, it } from 'vitest';
import { signState, verifyState } from '../api/_lib/auth';
import {
  buildImageMigrateXml,
  buildProductXml,
  cloudinaryToJpeg,
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

describe('cloudinaryToJpeg', () => {
  it('requests a JPEG rendition of a Cloudinary WebP', () => {
    expect(
      cloudinaryToJpeg('https://res.cloudinary.com/demo/image/upload/v1/quantumstore/products/123-abc.webp'),
    ).toBe('https://res.cloudinary.com/demo/image/upload/f_jpg,q_90/v1/quantumstore/products/123-abc.jpg');
  });

  it('leaves non-Cloudinary URLs alone', () => {
    const url = 'https://example.com/a/upload/b.webp';
    expect(cloudinaryToJpeg(url)).toBe(url);
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
