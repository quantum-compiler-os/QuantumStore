import { useEffect, useMemo, useRef, useState } from 'react';
import type { Order } from '../../api/types';
import { useToast } from '../../context/ToastContext';
import { usePkrRate } from '../../hooks/usePkrRate';
import AwbLabel from './AwbLabel';
import {
  ADDRESS_TYPES,
  SERVICES,
  buildAwb,
  loadOverrides,
  loadSender,
  orderRef,
  saveOverrides,
  saveSender,
  type AwbOverrides,
  type AwbSender,
} from './awbData';
import { printAwbMarkup } from './printAwb';

type Props = {
  order: Order;
  onClose: () => void;
  /** Called after the print dialog opened, e.g. to mark the order in the list. */
  onPrinted?: (orderId: string) => void;
};

/** Preview of an order's airway bill with the values the courier decides, and the Print button. */
export default function AwbDialog({ order, onClose, onPrinted }: Props) {
  const toast = useToast();
  const { rate, ready } = usePkrRate();
  const [overrides, setOverrides] = useState<AwbOverrides>(() => loadOverrides(order._id));
  const [sender, setSender] = useState<AwbSender>(() => loadSender());
  const [printing, setPrinting] = useState(false);
  const labelRef = useRef<HTMLDivElement>(null);
  const loaded = useRef({ overrides, sender });

  const awb = useMemo(() => buildAwb(order, { pkrRate: rate, sender, overrides }), [order, rate, sender, overrides]);

  // What is typed is kept for the next time this order (or any label, for the sender) is opened.
  useEffect(() => {
    if (overrides !== loaded.current.overrides) saveOverrides(order._id, overrides);
  }, [order._id, overrides]);
  useEffect(() => {
    if (sender !== loaded.current.sender) saveSender(sender);
  }, [sender]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function change<K extends keyof AwbOverrides>(key: K, value: AwbOverrides[K]) {
    setOverrides((current) => ({ ...current, [key]: value }));
  }

  function changeSender<K extends keyof AwbSender>(key: K, value: string) {
    setSender((current) => ({ ...current, [key]: value }));
  }

  async function print() {
    if (!labelRef.current) return;
    setPrinting(true);
    try {
      setOverrides((current) => ({ ...current, printedAt: new Date().toISOString() }));
      await printAwbMarkup([labelRef.current.outerHTML], `AWB ${awb.trackingNumber}`);
      onPrinted?.(order._id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not open the print dialog');
    } finally {
      setPrinting(false);
    }
  }

  const ref = orderRef(order._id);

  return (
    <div className="awb-overlay" role="dialog" aria-modal="true" aria-labelledby="awb-title" onClick={onClose}>
      <div className="awb-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="awb-dialog-head">
          <div>
            <h2 id="awb-title">Print AWB</h2>
            <p className="muted">
              Order {ref} · {order.customerName}
            </p>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="awb-dialog-body">
          <div className="awb-preview">
            <AwbLabel ref={labelRef} awb={awb} />
          </div>

          <form
            className="awb-form"
            onSubmit={(e) => {
              e.preventDefault();
              void print();
            }}
          >
            <label>
              Tracking number
              <input
                className="input"
                value={overrides.trackingNumber ?? ''}
                placeholder={ref.toUpperCase()}
                onChange={(e) => change('trackingNumber', e.target.value)}
              />
              <span className="field-hint">
                Paste the Leopards CN after booking the parcel. Left empty, the order reference is printed.
              </span>
            </label>

            <div className="awb-form-row">
              <label>
                Destination
                <input
                  className="input"
                  value={overrides.destination ?? ''}
                  placeholder={awb.destination}
                  maxLength={6}
                  onChange={(e) => change('destination', e.target.value)}
                />
              </label>
              <label>
                City
                <input
                  className="input"
                  value={overrides.city ?? ''}
                  placeholder={awb.recipient.city}
                  onChange={(e) => change('city', e.target.value)}
                />
              </label>
            </div>

            <div className="awb-form-row">
              <label>
                Service
                <select className="input" value={awb.service} onChange={(e) => change('service', e.target.value)}>
                  {SERVICES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label>
                Weight (kg)
                <input
                  className="input"
                  inputMode="decimal"
                  value={overrides.weight ?? ''}
                  placeholder={awb.weight}
                  onChange={(e) => change('weight', e.target.value)}
                />
              </label>
            </div>

            <div className="awb-form-row">
              <label>
                Address type
                <select
                  className="input"
                  value={awb.addressType}
                  onChange={(e) => change('addressType', e.target.value)}
                >
                  {ADDRESS_TYPES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label>
                Payment
                <select
                  className="input"
                  value={awb.payment}
                  onChange={(e) => change('payment', e.target.value as 'COD' | 'PREPAID')}
                >
                  <option value="COD">COD</option>
                  <option value="PREPAID">PREPAID</option>
                </select>
              </label>
            </div>

            <label>
              Cash to collect (Rs)
              <input
                className="input"
                type="number"
                min={0}
                step={1}
                disabled={awb.payment === 'PREPAID'}
                value={awb.payment === 'PREPAID' ? 0 : (overrides.amount ?? awb.amount)}
                onChange={(e) => change('amount', e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)))}
              />
              {!ready && <span className="field-hint">Loading the PKR rate…</span>}
            </label>

            <details className="awb-sender-form">
              <summary>Sender details</summary>
              <label>
                Name
                <input className="input" value={sender.name} onChange={(e) => changeSender('name', e.target.value)} />
              </label>
              <label>
                Address
                <textarea
                  className="input"
                  rows={2}
                  value={sender.address}
                  onChange={(e) => changeSender('address', e.target.value)}
                />
              </label>
              <div className="awb-form-row">
                <label>
                  Phone
                  <input
                    className="input"
                    value={sender.phone}
                    onChange={(e) => changeSender('phone', e.target.value)}
                  />
                </label>
                <label>
                  Courier code
                  <input
                    className="input"
                    value={sender.courierCode}
                    onChange={(e) => changeSender('courierCode', e.target.value)}
                  />
                </label>
              </div>
              <span className="field-hint">Saved on this computer for every label.</span>
            </details>

            <div className="awb-form-actions">
              <button type="submit" className="btn btn-primary" disabled={printing || !ready}>
                {printing ? 'Opening print…' : 'Print AWB'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Close
              </button>
            </div>
            {overrides.printedAt && (
              <p className="field-hint">Last printed {new Date(overrides.printedAt).toLocaleString()}</p>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
