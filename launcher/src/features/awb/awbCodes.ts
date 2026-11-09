import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';

/**
 * Code 128 bars for `text` as one string of 1s (bar) and 0s (space), one character per module. Drawn as SVG by the
 * label, so it prints sharp at any size. Throws for text Code 128 cannot hold.
 */
export function code128Modules(text: string) {
  const target: { encodings?: Array<{ data?: string }> } = {};
  let valid = true;
  JsBarcode(target as unknown as SVGElement, text, {
    format: 'CODE128',
    displayValue: false,
    margin: 0,
    valid: (ok) => {
      valid = ok;
    },
  });
  const data = (target.encodings || []).map((e) => e.data || '').join('');
  if (!valid || !data) throw new Error(`"${text}" cannot be printed as a barcode`);
  return data;
}

/** SVG path data for the bars: one rectangle per run of bars, in module units (height 1). */
export function barcodePath(modules: string) {
  let d = '';
  for (let i = 0; i < modules.length; ) {
    if (modules[i] !== '1') {
      i += 1;
      continue;
    }
    let end = i;
    while (modules[end] === '1') end += 1;
    d += `M${i} 0h${end - i}v1h${-(end - i)}z`;
    i = end;
  }
  return d;
}

/** The QR code for `text`: its size in modules and SVG path data with one square per dark module. */
export function qrPath(text: string) {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: 'M' });
  let d = '';
  for (let row = 0; row < modules.size; row += 1) {
    for (let col = 0; col < modules.size; col += 1) {
      if (modules.data[row * modules.size + col]) d += `M${col} ${row}h1v1h-1z`;
    }
  }
  return { size: modules.size, d };
}
