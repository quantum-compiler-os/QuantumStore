import { useEffect, useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import api from '../../api/client';
import type { User } from '../../api/types';
import { useAuth } from '../../context/AuthContext';
import DarazConnectionCard from '../../features/daraz/DarazConnectionCard';
import { useToast } from '../../context/ToastContext';
import { getErrorMessage } from '../../utils/errors';

export default function Settings() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({
    storeName: 'QuantumStore',
    supportEmail: 'admin@quaantumlogicslimited.com',
    lowStockThreshold: 10,
    companyName: 'Quantum Logics Limited',
    expressShippingFee: 15,
    lowStockDigestEnabled: true,
    loyaltyPointsPerDollar: 1,
    loyaltyRedemptionRate: 0.01,
    abandonedCartHours: 24,
    baseCurrency: 'USD',
    currenciesText: JSON.stringify(
      [
        { code: 'USD', symbol: '$', rate: 1 },
        { code: 'PKR', symbol: 'Rs', rate: 278 },
        { code: 'EUR', symbol: '€', rate: 0.92 },
      ],
      null,
      2
    ),
  });
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '' });
  const [staffForm, setStaffForm] = useState({ name: '', email: '', password: 'staff123' });
  const [staff, setStaff] = useState<User[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isAdmin) return;
    api
      .get('/settings')
      .then((res) => {
        const data = res.data || {};
        setForm((prev) => ({
          ...prev,
          storeName: data.storeName ?? prev.storeName,
          supportEmail: data.supportEmail ?? prev.supportEmail,
          lowStockThreshold: data.lowStockThreshold ?? prev.lowStockThreshold,
          companyName: data.companyName ?? prev.companyName,
          expressShippingFee: data.expressShippingFee ?? prev.expressShippingFee,
          lowStockDigestEnabled: data.lowStockDigestEnabled ?? prev.lowStockDigestEnabled,
          loyaltyPointsPerDollar: data.loyaltyPointsPerDollar ?? prev.loyaltyPointsPerDollar,
          loyaltyRedemptionRate: data.loyaltyRedemptionRate ?? prev.loyaltyRedemptionRate,
          abandonedCartHours: data.abandonedCartHours ?? prev.abandonedCartHours,
          baseCurrency: data.baseCurrency ?? prev.baseCurrency,
          currenciesText:
            data.currencies != null
              ? JSON.stringify(data.currencies, null, 2)
              : prev.currenciesText,
        }));
      })
      .catch(() => setError('Could not load settings'));
    api
      .get('/auth/staff')
      .then((res) => setStaff(res.data))
      .catch(() => {});
  }, [isAdmin]);

  if (!isAdmin) return <Navigate to="/" replace />;

  async function saveSettings(e: FormEvent) {
    e.preventDefault();
    try {
      let currencies;
      try {
        currencies = JSON.parse(form.currenciesText);
      } catch {
        setError('Currencies JSON is invalid');
        return;
      }
      const { currenciesText: _currenciesText, ...rest } = form;
      const { data } = await api.put('/settings', { ...rest, currencies });
      setForm((prev) => ({
        ...prev,
        storeName: data.storeName ?? prev.storeName,
        supportEmail: data.supportEmail ?? prev.supportEmail,
        lowStockThreshold: data.lowStockThreshold ?? prev.lowStockThreshold,
        companyName: data.companyName ?? prev.companyName,
        expressShippingFee: data.expressShippingFee ?? prev.expressShippingFee,
        lowStockDigestEnabled: data.lowStockDigestEnabled ?? prev.lowStockDigestEnabled,
        loyaltyPointsPerDollar: data.loyaltyPointsPerDollar ?? prev.loyaltyPointsPerDollar,
        loyaltyRedemptionRate: data.loyaltyRedemptionRate ?? prev.loyaltyRedemptionRate,
        abandonedCartHours: data.abandonedCartHours ?? prev.abandonedCartHours,
        baseCurrency: data.baseCurrency ?? prev.baseCurrency,
        currenciesText:
          data.currencies != null ? JSON.stringify(data.currencies, null, 2) : prev.currenciesText,
      }));
      toast.success('Settings saved');
    } catch (err) {
      setError(getErrorMessage(err, 'Could not save settings'));
    }
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    try {
      await api.patch('/auth/password', passwordForm);
      setPasswordForm({ currentPassword: '', newPassword: '' });
      toast.success('Password updated');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Password change failed'));
    }
  }

  async function inviteStaff(e: FormEvent) {
    e.preventDefault();
    try {
      await api.post('/auth/staff', staffForm);
      setStaffForm({ name: '', email: '', password: 'staff123' });
      const { data } = await api.get('/auth/staff');
      setStaff(data);
      toast.success('Staff invited');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not invite staff'));
    }
  }

  return (
    <div>
      <h1>Settings</h1>
      <p className="muted">Store configuration for Quantum Logics Limited.</p>
      {error && <p className="form-error">{error}</p>}

      <DarazConnectionCard />

      <form className="admin-form" onSubmit={saveSettings}>
        <div className="form-grid">
          <label>
            Store name
            <input className="input" value={form.storeName} onChange={(e) => setForm({ ...form, storeName: e.target.value })} />
          </label>
          <label>
            Company name
            <input className="input" value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} />
          </label>
          <label>
            Support email
            <input className="input" type="email" value={form.supportEmail} onChange={(e) => setForm({ ...form, supportEmail: e.target.value })} />
          </label>
          <label>
            Low stock threshold
            <input
              className="input"
              type="number"
              min="1"
              value={form.lowStockThreshold}
              onChange={(e) => setForm({ ...form, lowStockThreshold: Number(e.target.value) })}
            />
          </label>
          <label>
            Express shipping fee ($)
            <input
              className="input"
              type="number"
              min="0"
              step="0.01"
              value={form.expressShippingFee ?? 15}
              onChange={(e) => setForm({ ...form, expressShippingFee: Number(e.target.value) })}
            />
          </label>
          <label>
            Loyalty points per dollar
            <input
              className="input"
              type="number"
              min="0"
              step="0.1"
              value={form.loyaltyPointsPerDollar ?? 1}
              onChange={(e) => setForm({ ...form, loyaltyPointsPerDollar: Number(e.target.value) })}
            />
          </label>
          <label>
            Loyalty redemption rate ($ per point)
            <input
              className="input"
              type="number"
              min="0"
              step="0.001"
              value={form.loyaltyRedemptionRate ?? 0.01}
              onChange={(e) => setForm({ ...form, loyaltyRedemptionRate: Number(e.target.value) })}
            />
          </label>
          <label>
            Abandoned cart hours
            <input
              className="input"
              type="number"
              min="1"
              value={form.abandonedCartHours ?? 24}
              onChange={(e) => setForm({ ...form, abandonedCartHours: Number(e.target.value) })}
            />
          </label>
          <label>
            Base currency
            <input
              className="input"
              value={form.baseCurrency || 'USD'}
              onChange={(e) => setForm({ ...form, baseCurrency: e.target.value })}
            />
          </label>
        </div>
        <label>
          Currencies (JSON)
          <textarea
            className="input"
            rows={6}
            value={form.currenciesText}
            onChange={(e) => setForm({ ...form, currenciesText: e.target.value })}
          />
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={form.lowStockDigestEnabled !== false}
            onChange={(e) => setForm({ ...form, lowStockDigestEnabled: e.target.checked })}
          />
          Email daily low-stock digest
        </label>
        <button type="submit" className="btn btn-primary">
          Save settings
        </button>
      </form>

      <form className="admin-form" onSubmit={changePassword}>
        <h2>Change password</h2>
        <label>
          Current password
          <input
            className="input"
            type="password"
            required
            value={passwordForm.currentPassword}
            onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
          />
        </label>
        <label>
          New password
          <input
            className="input"
            type="password"
            required
            minLength={6}
            value={passwordForm.newPassword}
            onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
          />
        </label>
        <button type="submit" className="btn btn-secondary">
          Update password
        </button>
      </form>

      <form className="admin-form" onSubmit={inviteStaff}>
        <h2>Team</h2>
        <p className="muted">Invite staff who can manage products and orders (not settings, coupons, or customers).</p>
        <div className="form-grid">
          <label>
            Name
            <input
              className="input"
              required
              value={staffForm.name}
              onChange={(e) => setStaffForm({ ...staffForm, name: e.target.value })}
            />
          </label>
          <label>
            Email
            <input
              className="input"
              type="email"
              required
              value={staffForm.email}
              onChange={(e) => setStaffForm({ ...staffForm, email: e.target.value })}
            />
          </label>
          <label>
            Temp password
            <input
              className="input"
              required
              minLength={6}
              value={staffForm.password}
              onChange={(e) => setStaffForm({ ...staffForm, password: e.target.value })}
            />
          </label>
        </div>
        <button type="submit" className="btn btn-primary">
          Invite staff
        </button>
      </form>

      <div className="table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Joined</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((member) => (
              <tr key={member._id}>
                <td>{member.name}</td>
                <td>{member.email}</td>
                <td>{member.createdAt ? new Date(member.createdAt).toLocaleDateString() : '—'}</td>
              </tr>
            ))}
            {!staff.length && (
              <tr>
                <td colSpan={3} className="muted">
                  No staff accounts yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
