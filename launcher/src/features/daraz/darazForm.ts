import type { PreparedListing } from '../../api/daraz';
import { grossUpPrice, commissionFor, groupOf } from './categoryGroups';

export type DarazForm = {
  categoryId: number | null;
  categoryLabel: string;
  sellerSku: string;
  price: string;
  specialPrice: string;
  quantity: string;
  weight: string;
  length: string;
  width: string;
  height: string;
  content: string;
  attributes: Record<string, string>;
};

/** Everything starts empty: the category, package size and category fields are worked out per product when publishing. */
export function initialDaraz(): DarazForm {
  return {
    categoryId: null,
    categoryLabel: '',
    sellerSku: '',
    price: '',
    specialPrice: '',
    quantity: '',
    weight: '',
    length: '',
    width: '',
    height: '',
    content: '',
    attributes: {},
  };
}

export function slugSku(name: string, suffix: string) {
  const base = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return `${base || 'PRODUCT'}-${suffix}`;
}

const PACKAGE_FIELDS = ['weight', 'length', 'width', 'height'] as const;

/** Merges the AI's work into the form. Anything the seller typed or picked is kept as it is. */
export function applyPrepared(daraz: DarazForm, prepared: PreparedListing): DarazForm {
  const typed = Object.fromEntries(Object.entries(daraz.attributes).filter(([, v]) => v.trim()));
  const next: DarazForm = { ...daraz, attributes: { ...prepared.attributes, ...typed } };

  if (daraz.categoryId === null && prepared.category) {
    next.categoryId = prepared.category.id;
    next.categoryLabel = prepared.category.path;
  }
  if (prepared.package) {
    for (const field of PACKAGE_FIELDS) {
      if (!(Number(daraz[field]) > 0)) next[field] = String(prepared.package[field]);
    }
  }
  return next;
}

/** The Daraz price: what leaves the entered price after the chosen category's commission, unless a custom price is set. */
export function darazPrice(daraz: DarazForm, storePrice: string) {
  const custom = Number(daraz.price);
  if (custom > 0) return custom;
  const commission = daraz.categoryLabel ? commissionFor(groupOf(daraz.categoryLabel)) : null;
  return grossUpPrice(Number(storePrice), commission);
}

/** What Daraz still lacks before a listing can be sent, as a sentence for the seller; '' when it is complete. */
export function darazProblem(daraz: DarazForm, storePrice: string, storeStock: string): string {
  if (daraz.categoryId === null) return 'Could not pick a Daraz category — open "Daraz details" and choose one';
  if (!(darazPrice(daraz, storePrice) > 0)) return 'Enter a price for Daraz';
  const quantity = daraz.quantity || storeStock;
  if (quantity === '' || !Number.isInteger(Number(quantity))) {
    return 'Enter a stock quantity (Daraz requires one)';
  }
  for (const field of PACKAGE_FIELDS) {
    if (!(Number(daraz[field]) > 0)) return `Daraz needs the package ${field} — open "Daraz details" and enter it`;
  }
  return '';
}
