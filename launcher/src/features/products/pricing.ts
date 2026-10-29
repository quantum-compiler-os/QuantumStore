/**
 * The store keeps prices in its base unit and the storefront shows `price × PKR rate` as rupees. The forms in
 * the Launcher work in rupees, so a price is divided by the rate when it is saved and multiplied when it is
 * shown again. Without this, 8000 typed here would be stored as 8000 base units and shown as Rs 2,224,000.
 */
export const DEFAULT_PKR_RATE = 278; // the same fallback the storefront uses

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
