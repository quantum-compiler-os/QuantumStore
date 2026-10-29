import { describe, expect, it } from 'vitest';
import { buildProductPayload, emptyForm, parseVariants, productToForm } from '../src/features/products/productForm';
import { pkrRateFrom, rupeesToStored, storedToRupees } from '../src/features/products/pricing';
import type { Product } from '../src/api/types';

const RATE = 278;

describe('pricing', () => {
  it('stores the rupee price divided by the rate and gets the same rupees back', () => {
    const stored = rupeesToStored(8000, RATE);
    expect(stored).toBeCloseTo(28.776978, 6);
    // What the storefront shows is Math.round(stored × rate): exactly what was typed.
    expect(Math.round(stored * RATE)).toBe(8000);
    expect(storedToRupees(stored, RATE)).toBe(8000);
  });

  it('round-trips awkward prices to the rupee', () => {
    for (const rupees of [1, 99, 155, 1799, 12345, 249999]) {
      expect(Math.round(rupeesToStored(rupees, RATE) * RATE)).toBe(rupees);
    }
  });

  it('reads the PKR rate from the settings, or nothing', () => {
    expect(pkrRateFrom([{ code: 'PKR', rate: 280 }])).toBe(280);
    expect(pkrRateFrom([{ code: 'USD', rate: 1 }])).toBeUndefined();
    expect(pkrRateFrom(undefined)).toBeUndefined();
  });
});

describe('product form prices', () => {
  it('saves the price and variant prices in the stored unit', () => {
    const payload = buildProductPayload(
      { ...emptyForm, price: '8000', images: [{ url: 'https://x/a.jpg', thumbnail: 'https://x/a.jpg' }], variantsText: 'Set,278,2' },
      RATE,
    );
    expect(payload.price).toBeCloseTo(28.776978, 6);
    expect(payload.variants).toEqual([{ label: 'Set', price: 1, stock: 2 }]);
  });

  it('shows stored prices as rupees when editing', () => {
    const product = {
      name: 'Book',
      description: 'A book about things.',
      price: 28.776978,
      category: 'Books',
      image: 'https://x/a.jpg',
      variants: [{ label: 'Set', price: 1, stock: 2 }],
    } as unknown as Product;
    const form = productToForm(product, RATE);
    expect(form.price).toBe('8000');
    expect(form.variantsText).toBe('Set,278,2');
  });

  it('keeps variant prices as typed when no rate is given', () => {
    expect(parseVariants('A,10,1')).toEqual([{ label: 'A', price: 10, stock: 1 }]);
  });
});
