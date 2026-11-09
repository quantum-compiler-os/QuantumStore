import { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef } from 'react';
import { barcodePath, code128Modules, qrPath } from './awbCodes';
import { formatAmount, type AwbFields } from './awbData';
// Black-and-white copy of public/favicon.png, made for printing (1.8 kB, inlined as a data URL).
import storeLogo from './quantum-logo-bw.png?inline';

/**
 * Label styles. They travel inside the label's own markup (a <style> element), so the print window needs nothing
 * from the app's stylesheet. Sizes are in millimetres and follow Daraz's Leopards AWB: a 120 × 170 mm page.
 */
export const AWB_CSS = `
.awb-page{position:relative;width:120mm;height:170mm;background:#fff;color:#000;font-family:Arial,Helvetica,sans-serif;
  overflow:hidden;-webkit-print-color-adjust:exact;print-color-adjust:exact;text-align:left;line-height:1.3}
.awb-page *{box-sizing:border-box;margin:0;padding:0}
.awb-inner{position:absolute;left:9.3mm;top:8.2mm;width:105.4mm}
.awb-head{display:grid;grid-template-columns:59mm 1fr;height:7.9mm;border:.35mm solid #000}
.awb-head>div{display:flex;align-items:center;justify-content:center;font-size:10pt}
.awb-head>div+div{border-left:.35mm solid #000}
.awb-barcode{display:block;width:97.4mm;height:35mm;margin:.7mm auto 0}
.awb-track{height:6.6mm;display:flex;align-items:center;justify-content:center;font-size:13pt;font-weight:700;white-space:nowrap}
.awb-main{display:grid;grid-template-columns:51.9mm 1fr;height:37mm;border:.35mm solid #000}
.awb-brand{display:flex;flex-direction:column;align-items:center;padding-top:1.7mm;border-right:.35mm solid #000}
.awb-logo{display:flex;flex-direction:column;align-items:center;justify-content:center;width:26.3mm;height:26.3mm}
.awb-logo img{display:block;width:22mm;height:auto}
.awb-logo span{font-size:9pt;font-weight:700;margin-top:.6mm;white-space:nowrap}
.awb-dest{font-size:17.5pt;font-weight:700;line-height:1;margin-top:2.2mm;white-space:nowrap}
.awb-facts{display:grid;grid-template-rows:repeat(5,1fr)}
.awb-facts>div{display:flex;align-items:center;justify-content:center;font-size:12pt;font-weight:700;white-space:nowrap;overflow:hidden}
.awb-facts>div+div{border-top:.35mm solid #000}
.awb-facts .awb-amount{gap:6mm}
.awb-order{height:15mm;border:.35mm solid #000;border-top:0}
.awb-order-no{height:7.4mm;display:flex;align-items:center;justify-content:center;font-size:11.5pt;white-space:nowrap;
  margin:0 .8mm;border-bottom:.3mm solid #000}
.awb-dates{height:7.2mm;display:flex;align-items:center;justify-content:space-around;font-size:9.2pt;white-space:nowrap}
.awb-foot{display:grid;grid-template-columns:42.8mm 1fr;height:55.3mm;border-right:.35mm solid #000;border-bottom:.35mm solid #000}
.awb-left{display:flex;flex-direction:column;border-right:.35mm solid #000}
.awb-qr{display:block;width:41mm;height:41mm;margin:.6mm auto 0}
.awb-code{margin-top:auto;height:12mm;border-left:.35mm solid #000;border-top:.35mm solid #000;text-align:center;font-size:10.5pt;padding-top:1.8mm}
.awb-right{display:flex;flex-direction:column;min-width:0}
.awb-party{padding:1.4mm 1.4mm 0 2mm;font-size:8.2pt;line-height:1.25;overflow:hidden;overflow-wrap:anywhere}
.awb-party p+p{margin-top:.6mm}
.awb-party .awb-label{font-size:1.15em;font-weight:700}
.awb-party .awb-city{font-size:1.1em;font-weight:700}
.awb-recipient{height:26.6mm;margin-right:.8mm;border-bottom:.3mm solid #000}
.awb-sender{flex:1;display:flex;flex-direction:column}
.awb-sender .awb-phone{margin-top:auto;margin-bottom:3.4mm}
`;

/**
 * The store's mark where Daraz's label has the courier's: the QuantumStore logo in pure black and white (it prints
 * crisp on label printers) with the shop name under it. The picture is inlined, so the print window needs no request.
 */
function StoreLogo({ name }: { name: string }) {
  return (
    <div className="awb-logo">
      <img src={storeLogo} alt="" />
      <span>{name}</span>
    </div>
  );
}

function Barcode({ value }: { value: string }) {
  const bars = useMemo(() => {
    try {
      const modules = code128Modules(value);
      return { width: modules.length, d: barcodePath(modules) };
    } catch {
      return null;
    }
  }, [value]);
  if (!bars) return <div className="awb-barcode" />;
  return (
    <svg
      className="awb-barcode"
      viewBox={`0 0 ${bars.width} 1`}
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
      aria-label={`Barcode ${value}`}
    >
      <path d={bars.d} fill="#000" />
    </svg>
  );
}

function QrCode({ value }: { value: string }) {
  const qr = useMemo(() => (value ? qrPath(value) : null), [value]);
  if (!qr) return <div className="awb-qr" />;
  return (
    <svg className="awb-qr" viewBox={`0 0 ${qr.size} ${qr.size}`} shapeRendering="crispEdges" aria-label="QR code">
      <path d={qr.d} fill="#000" />
    </svg>
  );
}

const MIN_FIT_PT = 6;

/**
 * Shrinks the type of the recipient and sender blocks until their text fits the box, so a long address is printed
 * small rather than cut off. The size is written inline, so it is part of the markup that gets printed.
 */
function fitText(label: HTMLElement) {
  for (const box of label.querySelectorAll<HTMLElement>('.awb-fit')) {
    box.style.fontSize = '';
    let pt = parseFloat(getComputedStyle(box).fontSize) * 0.75;
    while (box.scrollHeight > box.clientHeight + 1 && pt > MIN_FIT_PT) {
      pt = Math.max(MIN_FIT_PT, pt - 0.25);
      box.style.fontSize = `${pt}pt`;
    }
  }
}

/** One airway bill. Pass a ref to read its markup for printing (see printAwb). */
const AwbLabel = forwardRef<HTMLDivElement, { awb: AwbFields }>(function AwbLabel({ awb }, ref) {
  const { recipient, sender } = awb;
  const pageRef = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => pageRef.current as HTMLDivElement, []);
  useLayoutEffect(() => {
    if (pageRef.current) fitText(pageRef.current);
  }, [awb]);
  return (
    <div className="awb-page" ref={pageRef}>
      <style>{AWB_CSS}</style>
      <div className="awb-inner">
        <div className="awb-head">
          <div>Sales_order</div>
          <div>{awb.channel}</div>
        </div>
        <Barcode value={awb.trackingNumber} />
        <div className="awb-track">Tracking Number {awb.trackingNumber}</div>

        <div className="awb-main">
          <div className="awb-brand">
            <StoreLogo name={sender.name} />
            <div className="awb-dest">{awb.destination}</div>
          </div>
          <div className="awb-facts">
            <div>{awb.service}</div>
            <div>{awb.weight}</div>
            <div>{awb.addressType}</div>
            <div>{awb.payment}</div>
            <div className="awb-amount">
              <span>PKR</span>
              <span>{formatAmount(awb.amount)}</span>
            </div>
          </div>
        </div>

        <div className="awb-order">
          <div className="awb-order-no">Order Number {awb.orderNumber}</div>
          <div className="awb-dates">
            <span>Order Creation Date {awb.orderDate}</span>
            <span>AWB Print Date {awb.printDate}</span>
          </div>
        </div>

        <div className="awb-foot">
          <div className="awb-left">
            <QrCode value={awb.trackingNumber} />
            <div className="awb-code">{sender.courierCode}</div>
          </div>
          <div className="awb-right">
            <div className="awb-party awb-fit awb-recipient">
              <p>
                <span className="awb-label">Recipient</span> {recipient.name}
              </p>
              <p>{recipient.address}</p>
              {recipient.city && <p className="awb-city">{recipient.city}</p>}
              <p>{recipient.phone}</p>
            </div>
            <div className="awb-party awb-fit awb-sender">
              <p>
                <span className="awb-label">Sender</span> {sender.name}
              </p>
              <p>{sender.address}</p>
              <p className="awb-phone">{sender.phone}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

export default AwbLabel;
