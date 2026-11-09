import { describe, expect, it } from 'vitest';
import type { Order } from '../src/api/types';
import { barcodePath, code128Modules, qrPath } from '../src/features/awb/awbCodes';
import {
  DEFAULT_SENDER,
  buildAwb,
  detectCity,
  formatAmount,
  formatOrderDate,
  formatPrintDate,
  orderRef,
  orderTotalPkr,
} from '../src/features/awb/awbData';

const order: Order = {
  _id: '6650f1a2b3c4d5e6f7a8b9c0',
  customerName: 'Daniyal Khan',
  email: 'buyer@example.com',
  phone: '03001234567',
  address: 'Shop no 4, Al-Abbas Plaza, Khanna, Rawalpindi',
  status: 'pending',
  items: [{ name: 'Power Bank', price: 10, quantity: 1 }],
  totalAmount: 38.94,
  shippingMethod: 'standard',
  paymentMethod: 'manual',
  paymentStatus: 'unpaid',
  createdAt: '2026-11-05T12:58:05.000Z',
};

describe('detectCity', () => {
  it('finds a known city and its courier code (Rawalpindi is sorted at Islamabad)', () => {
    expect(detectCity(order.address!)).toEqual({ city: 'Rawalpindi', code: 'ISB' });
    expect(detectCity('Flat 2, Clifton Block 5\nKarachi')).toEqual({ city: 'Karachi', code: 'KHI' });
  });

  it('prefers the city named last, so street names do not win', () => {
    expect(detectCity('House 4, Lahore Road, Sheikhupura')).toEqual({ city: 'Sheikhupura', code: 'SKP' });
  });

  it('matches whole words, ignoring case and extra spaces', () => {
    expect(detectCity('near chowk, rahim   yar khan')).toEqual({ city: 'Rahim Yar Khan', code: 'RYK' });
    expect(detectCity('Mohalla Lahorian, Daska').code).not.toBe('LHE');
  });

  it('falls back to the last part of the address for unknown towns', () => {
    expect(detectCity('Street 9, Kot Momin 40100')).toEqual({ city: 'Kot Momin', code: 'KOT' });
    expect(detectCity('')).toEqual({ city: '', code: '' });
  });
});

describe('formatting', () => {
  it('prints rupees with grouping and two decimals, like the Leopards label', () => {
    expect(formatAmount(10826)).toBe('10,826.00');
    expect(formatAmount(0)).toBe('0.00');
  });

  it('prints the order date as "05 Nov 2026" and the print date as yyyy-mm-dd', () => {
    expect(formatOrderDate(new Date(2026, 10, 5, 17, 58))).toBe('05 Nov 2026');
    expect(formatOrderDate(undefined)).toBe('');
    expect(formatPrintDate(new Date(2026, 10, 8, 9))).toBe('2026-11-08');
  });

  it('uses the same 8-character order reference as the storefront invoice', () => {
    expect(orderRef(order._id)).toBe('f7a8b9c0');
  });
});

describe('buildAwb', () => {
  const now = new Date(2026, 10, 8, 10);

  it('fills a cash-on-delivery label from the order', () => {
    const awb = buildAwb(order, { pkrRate: 278, now });
    expect(awb).toMatchObject({
      trackingNumber: 'F7A8B9C0',
      destination: 'ISB',
      service: 'STANDARD',
      weight: '0.5',
      addressType: 'HOME',
      payment: 'COD',
      amount: 10825, // 38.94 × 278, rounded to whole rupees
      orderNumber: 'f7a8b9c0',
      printDate: '2026-11-08',
      recipient: { name: 'Daniyal Khan', address: order.address, city: 'Rawalpindi', phone: '03001234567' },
      sender: DEFAULT_SENDER,
    });
  });

  it('collects nothing for paid orders and marks express shipping', () => {
    const awb = buildAwb({ ...order, paymentStatus: 'paid', shippingMethod: 'express' }, { pkrRate: 278, now });
    expect(awb.payment).toBe('PREPAID');
    expect(awb.amount).toBe(0);
    expect(awb.service).toBe('EXPRESS');
  });

  it('uses what was typed for the courier fields', () => {
    const awb = buildAwb(order, {
      pkrRate: 278,
      now,
      overrides: { trackingNumber: ' LE9016183180 ', destination: 'rwp', weight: '0.2', amount: 10826, city: 'Rawalpindi - Khanna' },
    });
    expect(awb.trackingNumber).toBe('LE9016183180');
    expect(awb.destination).toBe('RWP');
    expect(awb.weight).toBe('0.2');
    expect(awb.amount).toBe(10826);
    expect(awb.recipient.city).toBe('Rawalpindi - Khanna');
  });

  it('turns the stored order total back into rupees', () => {
    expect(orderTotalPkr({ totalAmount: 37.769784 }, 278)).toBe(10500);
    expect(orderTotalPkr({ total: 1 }, 280)).toBe(280);
  });
});

describe('barcode and QR code', () => {
  it('encodes Code 128 with a start code, whole symbols and the stop pattern', () => {
    const modules = code128Modules('LE9016183180');
    expect(modules).toMatch(/^[01]+$/);
    expect(['11010000100', '11010010000', '11010011100']).toContain(modules.slice(0, 11));
    expect(modules.endsWith('1100011101011')).toBe(true);
    expect(modules.length % 11).toBe(2);
    expect(code128Modules('LE9016183180')).toBe(modules);
    expect(code128Modules('F7A8B9C0')).not.toBe(modules);
  });

  it('refuses text Code 128 cannot hold', () => {
    expect(() => code128Modules('Ünïcode')).toThrow(/barcode/);
  });

  it('draws one bar per run of 1s', () => {
    expect(barcodePath('1101000111')).toBe('M0 0h2v1h-2zM3 0h1v1h-1zM7 0h3v1h-3z');
    expect(barcodePath('000')).toBe('');
  });

  it('draws the QR code module by module', () => {
    const qr = qrPath('LE9016183180');
    expect(qr.size).toBe(21);
    // The finder pattern's top-left corner is always dark.
    expect(qr.d.startsWith('M0 0h1v1h-1z')).toBe(true);
    expect(qrPath('LE9016183180').d).toBe(qr.d);
  });
});
