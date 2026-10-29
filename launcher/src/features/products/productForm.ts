import type { Product, ProductVariant } from '../../api/types';
import { rupeesToStored, storedToRupees } from './pricing';

export type ProductImage = { url: string; thumbnail: string };

export type ProductForm = {
  name: string;
  description: string;
  price: string;
  category: string;
  stock: string;
  images: ProductImage[];
  variantsText: string;
  specsText: string;
  productType: 'standard' | 'gift_card';
  brand: string;
  featured: boolean;
};

export const emptyForm: ProductForm = {
  name: '',
  description: '',
  price: '',
  category: 'Laptops',
  stock: '',
  images: [],
  variantsText: '',
  specsText: '',
  productType: 'standard',
  brand: 'Quantum',
  featured: false,
};

/** Variant prices are typed in rupees; `rate` turns them into the stored value (1 keeps them as typed). */
export function parseVariants(text: string, rate = 1): ProductVariant[] {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [label, price, stock] = line.split(',').map((part) => part.trim());
      return {
        label,
        price: rupeesToStored(Number(price), rate),
        // Blank stock = untracked (always available)
        stock: stock ? Number(stock) : null,
      };
    })
    .filter((v) => v.label && Number.isFinite(v.price) && (v.stock === null || Number.isFinite(v.stock)));
}

export function parseSpecs(text: string) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf(':');
      if (idx < 1) return null;
      return { key: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim() };
    })
    .filter((s): s is { key: string; value: string } => Boolean(s?.key && s?.value));
}

/**
 * Body for `POST/PUT /api/products`. The first image is the cover, the rest go in `images`.
 * Prices in the form are rupees; `rate` (PKR per base unit) converts them to what the store keeps.
 */
export function buildProductPayload(form: ProductForm, rate: number) {
  const [cover, ...rest] = form.images;
  return {
    name: form.name,
    description: form.description,
    price: rupeesToStored(Number(form.price), rate),
    category: form.category,
    stock: form.stock.trim() === '' ? null : Number(form.stock),
    image: cover.url,
    thumbnail: cover.thumbnail || undefined,
    brand: form.brand,
    featured: form.featured,
    images: rest.map((img) => img.url),
    variants: parseVariants(form.variantsText, rate),
    specs: parseSpecs(form.specsText),
    productType: form.productType,
  };
}

/** The edit form shows rupees, so the stored prices are multiplied by `rate`. */
export function productToForm(product: Product, rate: number): ProductForm {
  return {
    name: product.name,
    description: product.description,
    price: String(storedToRupees(product.price, rate)),
    category: product.category,
    stock: product.stock == null ? '' : String(product.stock),
    images: [
      { url: product.image, thumbnail: product.thumbnail || product.image },
      ...(product.images || []).map((url) => ({ url, thumbnail: url })),
    ],
    variantsText: (product.variants || []).map((v) => `${v.label},${storedToRupees(v.price, rate)},${v.stock ?? ''}`).join('\n'),
    specsText: (product.specs || []).map((s) => `${s.key}:${s.value}`).join('\n'),
    productType: product.productType === 'gift_card' ? 'gift_card' : 'standard',
    brand: product.brand || 'Quantum',
    featured: Boolean(product.featured),
  };
}
