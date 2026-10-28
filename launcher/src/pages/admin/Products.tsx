import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../api/client';
import { getDarazListings } from '../../api/daraz';
import type { Product } from '../../api/types';
import { useConfirm } from '../../context/ConfirmContext';
import { useToast } from '../../context/ToastContext';
import ProductFormFields from '../../features/products/ProductFormFields';
import { buildProductPayload, emptyForm, productToForm, type ProductForm } from '../../features/products/productForm';
import { queryKeys } from '../../hooks/queryKeys';
import { useProductCategoryNames, useProducts } from '../../hooks/useProducts';
import { getErrorMessage } from '../../utils/errors';

export default function Products() {
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [stockFilter, setStockFilter] = useState<'all' | 'in' | 'out'>('all');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [syncingAudionic, setSyncingAudionic] = useState(false);

  const { data: productsData, isError } = useProducts({
    search: appliedSearch || undefined,
    category: categoryFilter !== 'All' ? categoryFilter : undefined,
    inStock: stockFilter === 'all' ? undefined : stockFilter === 'in' ? 'true' : 'false',
    page,
    limit: 10,
    sort: 'newest',
  });
  const { data: categoryNames } = useProductCategoryNames();
  const products = productsData?.items || [];
  const pages = productsData?.pages || 1;
  const categories = categoryNames?.length ? categoryNames : ['Laptops'];
  const loadError = isError ? 'Failed to load products' : '';

  // Daraz is optional: if it is not configured the lookup just fails and no badges show.
  const pageIds = products.map((p) => p._id);
  const { data: darazListings } = useQuery({
    queryKey: ['daraz', 'listings', pageIds],
    queryFn: () => getDarazListings(pageIds),
    enabled: pageIds.length > 0,
    retry: false,
  });

  async function invalidate() {
    await queryClient.invalidateQueries({ queryKey: queryKeys.products.all });
  }

  async function syncAudionic() {
    setSyncingAudionic(true);
    try {
      const { data } = await api.post<{ created: number; updated: number; markedSoldOut: number }>(
        '/products/sync/audionic',
      );
      await invalidate();
      const soldOut = data.markedSoldOut ? `, ${data.markedSoldOut} marked sold out` : '';
      toast.success(`Audionic synced: ${data.created} new, ${data.updated} updated${soldOut}`);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Audionic sync failed'));
    } finally {
      setSyncingAudionic(false);
    }
  }

  function startEdit(product: Product) {
    setEditingId(product._id);
    setForm(productToForm(product));
    setError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function resetForm() {
    setEditingId(null);
    setForm({ ...emptyForm, category: categories[0] || 'Laptops' });
    setError('');
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!editingId) return;
    setSaving(true);
    setError('');
    if (!form.images.length) {
      setError('At least one product image is required');
      setSaving(false);
      return;
    }
    try {
      await api.put(`/products/${editingId}`, buildProductPayload(form));
      resetForm();
      await invalidate();
      toast.success('Product saved');
    } catch (err) {
      setError(getErrorMessage(err, 'Could not save product'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    const ok = await confirm('This will permanently remove the product from your catalog.', {
      title: 'Delete this product?',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await api.delete(`/products/${id}`);
      await invalidate();
      toast.success('Product deleted');
    } catch (err) {
      setError(getErrorMessage(err, 'Could not delete product'));
    }
  }

  async function saveStock(id: string, stock: number | null) {
    try {
      await api.patch(`/products/${id}/stock`, { stock });
      toast.success('Stock updated');
      await invalidate();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Stock update failed'));
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleSelectAll() {
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selected.includes(id));
    setSelected(allSelected ? [] : pageIds);
  }

  async function bulk(action: string) {
    if (!selected.length) return;
    if (action === 'delete') {
      const ok = await confirm(
        `This will permanently remove ${selected.length} product${selected.length === 1 ? '' : 's'} from your catalog.`,
        { title: 'Delete selected products?', confirmLabel: 'Delete', tone: 'danger' },
      );
      if (!ok) return;
    }
    try {
      await api.post('/products/bulk', { ids: selected, action });
      setSelected([]);
      await invalidate();
      toast.success('Bulk action complete');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Bulk action failed'));
    }
  }

  return (
    <div>
      <h1>Products</h1>
      <p className="muted">Edit or remove catalog items. New products are created from Publish.</p>

      <div className="admin-toolbar">
        <span className="muted">
          Audionic items are imported from audionic.co at Rs 100 below its prices and refresh daily — manual edits
          to them are overwritten.
        </span>
        <div className="admin-quick">
          <Link to="/publish" className="btn btn-primary">
            Publish new product
          </Link>
          <button type="button" className="btn btn-secondary" disabled={syncingAudionic} onClick={syncAudionic}>
            {syncingAudionic ? 'Syncing Audionic…' : 'Sync Audionic now'}
          </button>
        </div>
      </div>

      <div className="shop-top-row" style={{ marginBottom: '1rem' }}>
        <input
          className="input"
          placeholder="Search products…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            setPage(1);
            setAppliedSearch(search);
            setSelected([]);
          }}
        >
          Search
        </button>
        <select
          className="input"
          value={categoryFilter}
          onChange={(e) => {
            setCategoryFilter(e.target.value);
            setPage(1);
            setSelected([]);
          }}
        >
          <option value="All">All categories</option>
          {categories.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
      </div>

      <div className="category-row" style={{ marginBottom: '1rem' }}>
        {(
          [
            ['all', 'All stock'],
            ['in', 'In stock'],
            ['out', 'Out of stock'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={`chip ${stockFilter === value ? 'active' : ''}`}
            onClick={() => {
              setStockFilter(value);
              setPage(1);
              setSelected([]);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {editingId && (
        <form className="admin-form" onSubmit={handleSubmit}>
          <h2>Edit product</h2>
          <ProductFormFields
            form={form}
            setForm={setForm}
            categories={categories}
            onError={setError}
            onUploadingChange={setUploading}
          />
          {error && <p className="form-error">{error}</p>}
          <div className="admin-quick">
            <button type="submit" className="btn btn-primary" disabled={saving || uploading}>
              {saving ? 'Saving…' : 'Update product'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={resetForm}>
              Cancel edit
            </button>
          </div>
          {darazListings?.[editingId] && (
            <p className="muted">
              This product is also listed on Daraz (item {darazListings[editingId].itemId}). Changes here do not
              update the Daraz listing — edit it in Daraz Seller Center.
            </p>
          )}
        </form>
      )}
      {!editingId && (error || loadError) && <p className="form-error">{error || loadError}</p>}

      {selected.length > 0 && (
        <div className="admin-quick" style={{ marginBottom: '1rem', alignItems: 'center' }}>
          <span className="muted">{selected.length} selected</span>
          <button type="button" className="btn btn-ghost" onClick={() => bulk('feature')}>
            Feature selected
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => bulk('unfeature')}>
            Unfeature
          </button>
          <button type="button" className="btn btn-primary" onClick={() => bulk('delete')}>
            Delete selected ({selected.length})
          </button>
        </div>
      )}

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th className="col-check">
                <input
                  type="checkbox"
                  checked={products.length > 0 && products.every((p) => selected.includes(p._id))}
                  onChange={toggleSelectAll}
                  aria-label="Select all products on this page"
                />
              </th>
              <th>Product</th>
              <th>Category</th>
              <th>Price</th>
              <th>Stock</th>
              <th className="col-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product._id}>
                <td data-label="Select" className="col-check">
                  <input
                    type="checkbox"
                    checked={selected.includes(product._id)}
                    onChange={() => toggleSelect(product._id)}
                  />
                </td>
                <td data-label="Product">
                  <div className="table-product">
                    <img src={product.image} alt="" width="48" height="48" loading="lazy" />
                    <div>
                      <strong>{product.name}</strong>
                      <p className="muted">
                        {product.featured ? 'Featured' : 'Standard'}
                        {darazListings?.[product._id] && ` · Listed on Daraz (${darazListings[product._id].sellerSku})`}
                      </p>
                    </div>
                  </div>
                </td>
                <td data-label="Category">{product.category}</td>
                <td data-label="Price">Rs {product.price.toLocaleString()}</td>
                <td data-label="Stock">
                  <input
                    className="input qty-input"
                    type="number"
                    min="0"
                    placeholder="N/A"
                    defaultValue={product.stock ?? ''}
                    onBlur={(e) => {
                      const raw = e.target.value.trim();
                      const next = raw === '' ? null : Number(raw);
                      if (next !== product.stock) {
                        saveStock(product._id, next);
                      }
                    }}
                  />
                </td>
                <td data-label="Actions" className="col-actions">
                  <div className="table-actions">
                    <button type="button" className="text-btn" onClick={() => startEdit(product)}>
                      Edit
                    </button>
                    <button type="button" className="text-btn danger" onClick={() => handleDelete(product._id)}>
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="load-more">
        <button type="button" className="btn btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          Prev
        </button>
        <span className="muted">
          Page {page} / {pages}
        </span>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={page >= pages}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
