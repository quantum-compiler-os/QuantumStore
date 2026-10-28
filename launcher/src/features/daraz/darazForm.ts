const DEFAULTS_KEY = 'ql_daraz_defaults';

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

/** What is worth remembering between products: the category and the usual package size. */
type Remembered = Pick<DarazForm, 'categoryId' | 'categoryLabel' | 'weight' | 'length' | 'width' | 'height'>;

export function loadDefaults(): Partial<Remembered> {
  try {
    return JSON.parse(localStorage.getItem(DEFAULTS_KEY) || '{}');
  } catch {
    return {};
  }
}

export function saveDefaults(d: DarazForm) {
  try {
    const value: Remembered = {
      categoryId: d.categoryId,
      categoryLabel: d.categoryLabel,
      weight: d.weight,
      length: d.length,
      width: d.width,
      height: d.height,
    };
    localStorage.setItem(DEFAULTS_KEY, JSON.stringify(value));
  } catch {
    /* private mode — remembering is a convenience only */
  }
}

export function initialDaraz(): DarazForm {
  const saved = loadDefaults();
  return {
    categoryId: saved.categoryId ?? null,
    categoryLabel: saved.categoryLabel ?? '',
    sellerSku: '',
    price: '',
    specialPrice: '',
    quantity: '',
    weight: saved.weight ?? '',
    length: saved.length ?? '',
    width: saved.width ?? '',
    height: saved.height ?? '',
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
