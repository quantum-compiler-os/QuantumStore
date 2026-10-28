import { useEffect, useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import api from '../../api/client';
import type { Coupon } from '../../api/types';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { useToast } from '../../context/ToastContext';
import { getErrorMessage } from '../../utils/errors';

const empty = { code: '', percentOff: 10, usageLimit: 0, expiresAt: '', active: true };

export default function Coupons() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState('');

  async function load() {
    const { data } = await api.get('/coupons');
    setCoupons(data);
  }

  useEffect(() => {
    if (!isAdmin) return;
    load().catch(() => setError('Failed to load coupons'));
  }, [isAdmin]);

  if (!isAdmin) return <Navigate to="/" replace />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      await api.post('/coupons', {
        ...form,
        expiresAt: form.expiresAt || null,
      });
      setForm(empty);
      await load();
      toast.success('Coupon created');
    } catch (err) {
      setError(getErrorMessage(err, 'Could not create coupon'));
    }
  }

  async function remove(id: string) {
    const ok = await confirm('This will permanently remove the coupon.', {
      title: 'Delete this coupon?',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    await api.delete(`/coupons/${id}`);
    await load();
    toast.success('Coupon deleted');
  }

  return (
    <div>
      <h1>Coupons</h1>
      <p className="muted">Discount codes for checkout. Try seeded code WELCOME10.</p>

      <form className="admin-form" onSubmit={handleSubmit}>
        <div className="form-grid">
          <label>
            Code
            <input className="input" required minLength={3} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </label>
          <label>
            Percent off
            <input className="input" type="number" min="1" max="100" required value={form.percentOff} onChange={(e) => setForm({ ...form, percentOff: Number(e.target.value) })} />
          </label>
          <label>
            Usage limit (0 = unlimited)
            <input className="input" type="number" min="0" value={form.usageLimit} onChange={(e) => setForm({ ...form, usageLimit: Number(e.target.value) })} />
          </label>
          <label>
            Expires at
            <input className="input" type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} />
          </label>
        </div>
        {error && <p className="form-error">{error}</p>}
        <button type="submit" className="btn btn-primary">
          Add coupon
        </button>
      </form>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Off</th>
              <th>Used</th>
              <th>Active</th>
              <th className="col-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {coupons.map((coupon) => (
              <tr key={coupon._id}>
                <td data-label="Code">{coupon.code}</td>
                <td data-label="Off">{coupon.percentOff}%</td>
                <td data-label="Used">
                  {coupon.usedCount}
                  {coupon.usageLimit ? ` / ${coupon.usageLimit}` : ''}
                </td>
                <td data-label="Active">{coupon.active ? 'Yes' : 'No'}</td>
                <td data-label="Actions" className="col-actions">
                  <button type="button" className="text-btn danger" onClick={() => remove(coupon._id)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
