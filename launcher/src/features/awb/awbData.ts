import type { Order } from '../../api/types';

/**
 * Everything printed on an airway bill (AWB). The layout copies the Leopards label Daraz prints; the values come from a
 * QuantumStore order, and the ones the courier decides (tracking number, weight…) can be changed before printing.
 */
export type AwbFields = {
  /** The courier's consignment number once the parcel is booked; until then the order reference. */
  trackingNumber: string;
  /** Short destination code shown under the courier logo (ISB, LHE, KHI…). */
  destination: string;
  service: string;
  /** Kilograms, as typed ("0.5"). */
  weight: string;
  addressType: string;
  payment: 'COD' | 'PREPAID';
  /** Rupees the courier collects; 0 when prepaid. */
  amount: number;
  orderNumber: string;
  /** "05 Nov 2026" */
  orderDate: string;
  /** "2026-11-08" */
  printDate: string;
  channel: string;
  recipient: { name: string; address: string; city: string; phone: string };
  sender: AwbSender;
};

export type AwbSender = { name: string; address: string; phone: string; courierCode: string };

/** What a label can be changed to per order; remembered so a reprint matches the first print. */
export type AwbOverrides = Partial<
  Pick<AwbFields, 'trackingNumber' | 'destination' | 'service' | 'weight' | 'addressType' | 'payment' | 'amount'>
> & { city?: string; /** ISO time of the last print, so the order list can say the label is done. */ printedAt?: string };

export const DEFAULT_SENDER: AwbSender = {
  name: 'Quantum Store',
  address: '6/12 A block Canal City (Rail Town), Lahore, Punjab, Lahore - Canal City, Block A',
  phone: '03714467235',
  courierCode: 'PK-LCS-LHE',
};

export const SERVICES = ['STANDARD', 'EXPRESS', 'OVERNIGHT', 'OVERLAND'] as const;
export const ADDRESS_TYPES = ['HOME', 'WORK', 'OFFICE'] as const;
export const DEFAULT_WEIGHT = '0.5';

/** The reference customers see on their invoice and order pages. */
export function orderRef(id: string) {
  return String(id).slice(-8);
}

/**
 * Courier sorting codes for the cities parcels most often go to. Rawalpindi is sorted at the Islamabad hub, which is
 * why Daraz's Leopards labels print ISB for it.
 */
const CITY_CODES: Array<[string, string]> = [
  ['Karachi', 'KHI'],
  ['Lahore', 'LHE'],
  ['Islamabad', 'ISB'],
  ['Rawalpindi', 'ISB'],
  ['Faisalabad', 'FSD'],
  ['Multan', 'MUX'],
  ['Peshawar', 'PEW'],
  ['Quetta', 'UET'],
  ['Hyderabad', 'HDD'],
  ['Gujranwala', 'GRW'],
  ['Sialkot', 'SKT'],
  ['Sargodha', 'SGD'],
  ['Bahawalpur', 'BHV'],
  ['Sukkur', 'SKZ'],
  ['Abbottabad', 'ABT'],
  ['Gujrat', 'GRT'],
  ['Sahiwal', 'SWL'],
  ['Okara', 'OKR'],
  ['Jhelum', 'JLM'],
  ['Sheikhupura', 'SKP'],
  ['Kasur', 'KSR'],
  ['Rahim Yar Khan', 'RYK'],
  ['Dera Ghazi Khan', 'DGK'],
  ['Dera Ismail Khan', 'DIK'],
  ['Mardan', 'MDN'],
  ['Mirpur', 'MPD'],
  ['Muzaffarabad', 'MFG'],
  ['Larkana', 'LRK'],
  ['Nawabshah', 'WNS'],
  ['Wah Cantt', 'WAH'],
  ['Taxila', 'TXL'],
  ['Chakwal', 'CKL'],
  ['Attock', 'ATK'],
  ['Mandi Bahauddin', 'MBD'],
  ['Hafizabad', 'HFD'],
  ['Vehari', 'VHR'],
  ['Khanewal', 'KWL'],
  ['Jhang', 'JNG'],
  ['Mianwali', 'MWD'],
  ['Chiniot', 'CNT'],
  ['Swat', 'SWT'],
  ['Mingora', 'SWT'],
  ['Gilgit', 'GIL'],
  ['Skardu', 'KDU'],
  ['Gwadar', 'GWD'],
];

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The city of a free-text address and its courier code. Addresses end with the city more often than they start with
 * it ("House 4, Lahore Road, Sheikhupura"), so the known city mentioned last wins; with none known, the last part of
 * the address is taken as the city and its first three letters as the code.
 */
export function detectCity(address: string): { city: string; code: string } {
  const text = String(address || '');
  let best: { city: string; code: string; at: number } | null = null;
  for (const [city, code] of CITY_CODES) {
    const re = new RegExp(`\\b${escapeRegex(city).replace(/\s+/g, '\\s+')}\\b`, 'gi');
    for (const match of text.matchAll(re)) {
      const at = match.index ?? 0;
      if (!best || at > best.at || (at === best.at && city.length > best.city.length)) best = { city, code, at };
    }
  }
  if (best) return { city: best.city, code: best.code };

  const parts = text
    .split(/[,\n]/)
    .map((part) => part.replace(/\b\d{4,}\b/g, '').replace(/\s+/g, ' ').trim())
    .filter((part) => /[a-z]/i.test(part));
  const city = parts[parts.length - 1] || '';
  const code = city.replace(/[^a-z]/gi, '').slice(0, 3).toUpperCase();
  return { city, code };
}

/** "10,826.00" */
export function formatAmount(rupees: number) {
  return (Number(rupees) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "05 Nov 2026", in the computer's own time zone. */
export function formatOrderDate(value: string | Date | undefined) {
  const date = value ? new Date(value) : new Date(NaN);
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getDate()).padStart(2, '0')} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** "2026-11-08", in the computer's own time zone. */
export function formatPrintDate(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Pay on delivery orders ("manual") are cash on delivery until someone marks them paid. */
export function isPrepaid(order: Pick<Order, 'paymentStatus'>) {
  return order.paymentStatus === 'paid';
}

/** The order total in rupees. QuantumStore keeps amounts divided by the PKR rate, as it does for prices. */
export function orderTotalPkr(order: Pick<Order, 'totalAmount' | 'total'>, pkrRate: number) {
  return Math.round(Number(order.totalAmount ?? order.total ?? 0) * pkrRate);
}

export function buildAwb(
  order: Order,
  {
    pkrRate,
    sender = DEFAULT_SENDER,
    overrides = {},
    now = new Date(),
  }: { pkrRate: number; sender?: AwbSender; overrides?: AwbOverrides; now?: Date },
): AwbFields {
  const ref = orderRef(order._id);
  const detected = detectCity(order.address || '');
  const payment = overrides.payment ?? (isPrepaid(order) ? 'PREPAID' : 'COD');
  const amount = payment === 'PREPAID' ? 0 : (overrides.amount ?? orderTotalPkr(order, pkrRate));
  return {
    trackingNumber: (overrides.trackingNumber || '').trim() || ref.toUpperCase(),
    destination: (overrides.destination || '').trim().toUpperCase() || detected.code,
    service: overrides.service || (order.shippingMethod === 'express' ? 'EXPRESS' : 'STANDARD'),
    weight: (overrides.weight || '').trim() || DEFAULT_WEIGHT,
    addressType: overrides.addressType || 'HOME',
    payment,
    amount,
    orderNumber: ref,
    orderDate: formatOrderDate(order.createdAt),
    printDate: formatPrintDate(now),
    channel: 'website',
    recipient: {
      name: order.customerName || '',
      address: (order.address || '').trim(),
      city: overrides.city?.trim() || detected.city,
      phone: order.phone || '',
    },
    sender,
  };
}

const OVERRIDES_KEY = (orderId: string) => `quantum.awb.order.${orderId}`;
const SENDER_KEY = 'quantum.awb.sender';

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private windows and full storage only lose the convenience of remembering the values.
  }
}

export function loadOverrides(orderId: string): AwbOverrides {
  return readJson<AwbOverrides>(OVERRIDES_KEY(orderId)) || {};
}

export function saveOverrides(orderId: string, overrides: AwbOverrides) {
  writeJson(OVERRIDES_KEY(orderId), overrides);
}

export function loadSender(): AwbSender {
  return { ...DEFAULT_SENDER, ...readJson<Partial<AwbSender>>(SENDER_KEY) };
}

export function saveSender(sender: AwbSender) {
  writeJson(SENDER_KEY, sender);
}
