import type { Product, ProductVariant } from '../../api/types';

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

export function parseVariants(text: string): ProductVariant[] {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [label, price, stock] = line.split(',').map((part) => part.trim());
      return {
        label,
        price: Number(price),
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

/** Body for `POST/PUT /api/products`. The first image is the cover, the rest go in `images`. */
export function buildProductPayload(form: ProductForm) {
  const [cover, ...rest] = form.images;
  return {
    name: form.name,
    description: form.description,
    price: Number(form.price),
    category: form.category,
    stock: form.stock.trim() === '' ? null : Number(form.stock),
    image: cover.url,
    thumbnail: cover.thumbnail || undefined,
    brand: form.brand,
    featured: form.featured,
    images: rest.map((img) => img.url),
    variants: parseVariants(form.variantsText),
    specs: parseSpecs(form.specsText),
    productType: form.productType,
  };
}

export function productToForm(product: Product): ProductForm {
  return {
    name: product.name,
    description: product.description,
    price: String(product.price),
    category: product.category,
    stock: product.stock == null ? '' : String(product.stock),
    images: [
      { url: product.image, thumbnail: product.thumbnail || product.image },
      ...(product.images || []).map((url) => ({ url, thumbnail: url })),
    ],
    variantsText: (product.variants || []).map((v) => `${v.label},${v.price},${v.stock ?? ''}`).join('\n'),
    specsText: (product.specs || []).map((s) => `${s.key}:${s.value}`).join('\n'),
    productType: product.productType === 'gift_card' ? 'gift_card' : 'standard',
    brand: product.brand || 'Quantum',
    featured: Boolean(product.featured),
  };
}
