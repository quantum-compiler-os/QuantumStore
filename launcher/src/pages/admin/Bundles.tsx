import { useEffect, useState, type FormEvent } from 'react';
import api from '../../api/client';
import type { Bundle } from '../../api/types';
import { useConfirm } from '../../context/ConfirmContext';
import { useToast } from '../../context/ToastContext';
import { getErrorMessage } from '../../utils/errors';

type BundleForm = {
  name: string;
  image: string;
  bundlePrice: string;
  itemsText: string;
  active: boolean;
  description: string;
};

const empty: BundleForm = {
  name: '',
  image: '',
  bundlePrice: '',
  itemsText: '',
  active: true,
  description: '',
};

function parseItems(text: string) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [productId, qty] = line.split(',').map((p) => p.trim());
      return { productId, quantity: Math.max(1, Number(qty) || 1) };
    })
    .filter((i) => i.productId);
}

export default function Bundles() {
  const toast = useToast();
  const confirm = useConfirm();
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [form, setForm] = useState<BundleForm>(empty);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function load() {
    const { data } = await api.get<Bundle[]>('/bundles', { params: { active: 'all' } });
    setBundles(data);
  }

  useEffect(() => {
    load().catch(() => setError('Failed to load bundles'));
  }, []);

  function startEdit(bundle: Bundle) {
    setEditingId(bundle._id);
    setForm({
      name: bundle.name,
      image: bundle.image || '',
      bundlePrice: String(bundle.bundlePrice),
      description: bundle.description || '',
      active: bundle.active !== false,
      itemsText: bundle.items
        .map((item) => {
          const id = typeof item.product === 'string' ? item.product : item.product._id;
          return `${id},${item.quantity}`;
        })
        .join('\n'),
    });
  }

  function resetForm() {
    setEditingId(null);
    setForm(empty);
    setError('');
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const items = parseItems(form.itemsText);
    if (items.length < 2) {
      setError('Add at least 2 product lines (productId,qty)');
      return;
    }
    const payload = {
      name: form.name,
      image: form.image,
      description: form.description,
      bundlePrice: Number(form.bundlePrice),
      active: form.active,
      items,
    };
    try {
      if (editingId) await api.put(`/bundles/${editingId}`, payload);
      else await api.post('/bundles', payload);
      resetForm();
      await load();
      toast.success('Bundle saved');
    } catch (err) {
      setError(getErrorMessage(err, 'Could not save bundle'));
    }
  }

  async function remove(id: string) {
    const ok = await confirm('This will permanently remove the bundle.', {
      title: 'Delete this bundle?',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    await api.delete(`/bundles/${id}`);
    await load();
    toast.success('Bundle deleted');
  }

  return (
    <div>
      <h1>Bundles</h1>
      <p className="muted">Create multi-product deals with a shared bundle price.</p>

      <form className="admin-form" onSubmit={handleSubmit}>
        <h2>{editingId ? 'Edit bundle' : 'Add bundle'}</h2>
        <div className="form-grid">
          <label>
            Name
            <input
              className="input"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label>
            Bundle price
            <input
              className="input"
              type="number"
              min="0"
              step="0.01"
              required
              value={form.bundlePrice}
              onChange={(e) => setForm({ ...form, bundlePrice: e.target.value })}
            />
          </label>
          <label>
            Image URL
            <input
              className="input"
              value={form.image}
              onChange={(e) => setForm({ ...form, image: e.target.value })}
            />
          </label>
        </div>
        <label>
          Description
          <textarea
            className="input"
            rows={2}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </label>
        <label>
          Items (productId,qty — one per line, min 2)
          <textarea
            className="input"
            rows={4}
            required
            placeholder="64f…abc,1&#10;64f…def,2"
            value={form.itemsText}
            onChange={(e) => setForm({ ...form, itemsText: e.target.value })}
          />
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={form.active}
            onChange={(e) => setForm({ ...form, active: e.target.checked })}
          />
          Active
        </label>
        {error && <p className="form-error">{error}</p>}
        <div className="admin-quick">
          <button type="submit" className="btn btn-primary">
            {editingId ? 'Update bundle' : 'Add bundle'}
          </button>
          {editingId && (
            <button type="button" className="btn btn-ghost" onClick={resetForm}>
              Cancel
            </button>
          )}
        </div>
      </form>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Price</th>
              <th>Items</th>
              <th>Active</th>
              <th className="col-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {bundles.map((bundle) => (
              <tr key={bundle._id}>
                <td data-label="Name">{bundle.name}</td>
                <td data-label="Price">${bundle.bundlePrice.toFixed(2)}</td>
                <td data-label="Items">{bundle.items.length}</td>
                <td data-label="Active">{bundle.active !== false ? 'Yes' : 'No'}</td>
                <td data-label="Actions" className="col-actions">
                  <div className="table-actions">
                    <button type="button" className="text-btn" onClick={() => startEdit(bundle)}>
                      Edit
                    </button>
                    <button type="button" className="text-btn danger" onClick={() => remove(bundle._id)}>
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!bundles.length && (
              <tr>
                <td colSpan={5} className="muted">
                  No bundles yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
