import { useEffect, useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import api from '../../api/client';
import type { GiftCard } from '../../api/types';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { useToast } from '../../context/ToastContext';
import { getErrorMessage } from '../../utils/errors';

const empty = { amount: 25, recipientEmail: '', message: '' };

export default function GiftCards() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [cards, setCards] = useState<GiftCard[]>([]);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState('');

  async function load() {
    const { data } = await api.get<{ items: GiftCard[] }>('/giftcards');
    setCards(data.items || []);
  }

  useEffect(() => {
    if (!isAdmin) return;
    load().catch(() => setError('Failed to load gift cards'));
  }, [isAdmin]);

  if (!isAdmin) return <Navigate to="/" replace />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      await api.post('/giftcards', {
        amount: Number(form.amount),
        recipientEmail: form.recipientEmail || undefined,
        message: form.message || '',
      });
      setForm(empty);
      await load();
      toast.success('Gift card issued');
    } catch (err) {
      setError(getErrorMessage(err, 'Could not issue gift card'));
    }
  }

  async function deactivate(id: string) {
    const ok = await confirm('The code will stop working for future redemptions.', {
      title: 'Deactivate this gift card?',
      confirmLabel: 'Deactivate',
      tone: 'danger',
    });
    if (!ok) return;
    await api.patch(`/giftcards/${id}/deactivate`);
    await load();
    toast.success('Gift card deactivated');
  }

  return (
    <div>
      <h1>Gift cards</h1>
      <p className="muted">Issue store credit codes for customers.</p>

      <form className="admin-form" onSubmit={handleSubmit}>
        <div className="form-grid">
          <label>
            Amount
            <input
              className="input"
              type="number"
              min="1"
              step="0.01"
              required
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })}
            />
          </label>
          <label>
            Recipient email
            <input
              className="input"
              type="email"
              value={form.recipientEmail}
              onChange={(e) => setForm({ ...form, recipientEmail: e.target.value })}
            />
          </label>
          <label>
            Message
            <input
              className="input"
              value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })}
              maxLength={500}
            />
          </label>
        </div>
        {error && <p className="form-error">{error}</p>}
        <button type="submit" className="btn btn-primary">
          Issue gift card
        </button>
      </form>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Balance</th>
              <th>Recipient</th>
              <th>Active</th>
              <th className="col-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {cards.map((card) => (
              <tr key={card._id}>
                <td data-label="Code">{card.code}</td>
                <td data-label="Balance">
                  ${card.balance.toFixed(2)} / ${card.initialBalance.toFixed(2)}
                </td>
                <td data-label="Recipient">{card.recipientEmail || '—'}</td>
                <td data-label="Active">{card.active ? 'Yes' : 'No'}</td>
                <td data-label="Actions" className="col-actions">
                  {card.active && (
                    <button type="button" className="text-btn danger" onClick={() => deactivate(card._id)}>
                      Deactivate
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!cards.length && (
              <tr>
                <td colSpan={5} className="muted">
                  No gift cards yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
