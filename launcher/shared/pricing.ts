/**
 * The store keeps prices in its base unit and the storefront shows `price × PKR rate` as rupees. The forms in
 * the Launcher work in rupees, so a price is divided by the rate when it is saved and multiplied when it is
 * shown again. Without this, 8000 typed here would be stored as 8000 base units and shown as Rs 2,224,000.
 */
export const DEFAULT_PKR_RATE = 278; // the same fallback the storefront uses

/**
 * Rupees QuantumStore charges on top of the price a product comes in at: a supplier's price (Audionic, CamSham,
 * PakBooks, fetched shops) or what is left of a Daraz price after the commission. Only the QuantumStore price gets it;
 * Daraz is still priced from the supplier's own price. Products already in the store were raised by the same amount
 * once, from Settings → "Add to every price". A price typed by hand (Publish, Products) is stored as typed.
 */
export const STORE_EXTRA_PKR = 2000;

/** A supplier's (or Daraz's net) rupee price → what QuantumStore charges for it. */
export const storeRupees = (sourceRupees: number) => sourceRupees + STORE_EXTRA_PKR;

/** The PKR rate from the store settings' `currencies`, or undefined when there is none. */
export function pkrRateFrom(currencies: unknown): number | undefined {
  const list = Array.isArray(currencies) ? (currencies as Array<{ code?: string; rate?: unknown }>) : [];
  const rate = Number(list.find((c) => c?.code === 'PKR')?.rate);
  return rate > 0 ? rate : undefined;
}

/** Rupees → the value to store. Six decimals, as the Audionic sync does, so the rupee price comes back exact. */
export function rupeesToStored(rupees: number, rate: number) {
  return Math.round((rupees / rate) * 1e6) / 1e6;
}

/** Stored value → rupees, to the paisa. */
export function storedToRupees(stored: number, rate: number) {
  return Math.round(stored * rate * 100) / 100;
}
