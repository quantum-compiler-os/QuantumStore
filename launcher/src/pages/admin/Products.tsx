import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../api/client';
import { getAllDarazListings, getDarazCategories, getDarazListings, removeFromDaraz, updateDarazImages, updateDarazOffer } from '../../api/daraz';
import type { Product } from '../../api/types';
import { useConfirm } from '../../context/ConfirmContext';
import { useToast } from '../../context/ToastContext';
import DarazListingsCard from '../../features/daraz/DarazListingsCard';
import { darazOfferFor, hasOffer } from '../../features/daraz/darazOffer';
import ProductFormFields from '../../features/products/ProductFormFields';
import { chipCounts, matchesChannel, matchesStock, type Channel, type StockFilter } from '../../features/products/channelFilter';
import { rupeesToStored, storedToRupees } from '../../features/products/pricing';
import { buildProductPayload, emptyForm, productToForm, type ProductForm } from '../../features/products/productForm';
import { queryKeys } from '../../hooks/queryKeys';
import { usePkrRate } from '../../hooks/usePkrRate';
import { useAllProducts, useAudionicProducts, useProductCategoryNames, useProductFacets, useProducts } from '../../hooks/useProducts';
import { getErrorMessage } from '../../utils/errors';

const SORTS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
] as const;
const PAGE_SIZES = [10, 25, 48] as const;

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
  const [stockFilter, setStockFilter] = useState<StockFilter>('all');
  const [channel, setChannel] = useState<Channel>('all');
  const [brandFilter, setBrandFilter] = useState('All');
  const [sort, setSort] = useState<(typeof SORTS)[number]['value']>('newest');
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZES)[number]>(10);
  const [bulkStock, setBulkStock] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [removingImported, setRemovingImported] = useState(false);

  const sharedFilters = {
    search: appliedSearch || undefined,
    category: categoryFilter !== 'All' ? categoryFilter : undefined,
    brands: brandFilter !== 'All' ? brandFilter : undefined,
  };
  const { data: productsData, isError } = useProducts(
    {
      ...sharedFilters,
      inStock: stockFilter === 'all' ? undefined : stockFilter === 'in' ? 'true' : 'false',
      page,
      limit: pageSize,
      sort,
    },
    { enabled: channel === 'all' },
  );
  const { data: facets } = useProductFacets();

  // The backend does not know what is on Daraz, so that filter and the chip totals work from the whole matching list.
  // If Daraz is not set up the lookup just fails and the Daraz chips stay hidden.
  const catalog = useAllProducts({ ...sharedFilters, sort });
  const { data: allListings } = useQuery({
    queryKey: ['daraz', 'listings', 'all'],
    queryFn: getAllDarazListings,
    retry: false,
  });
  const listedIds = new Set((allListings ?? []).map((listing) => listing.quantumProductId));
  const counts = catalog.data && chipCounts(catalog.data, listedIds, { channel, stock: stockFilter });

  const { rate: pkrRate, ready: rateReady } = usePkrRate();
  const { data: categoryNames } = useProductCategoryNames();
  const channelMatches = (catalog.data ?? []).filter(
    (product) => matchesChannel(product._id, channel, listedIds) && matchesStock(product.stock, stockFilter),
  );
  const pages = channel === 'all' ? productsData?.pages || 1 : Math.max(1, Math.ceil(channelMatches.length / pageSize));
  // Deleting the last product of the last page leaves `page` past the end of this list.
  const currentPage = channel === 'all' ? page : Math.min(page, pages);
  const products =
    channel === 'all'
      ? productsData?.items || []
      : channelMatches.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const categories = categoryNames?.length ? categoryNames : ['Laptops'];
  const loadError = (channel === 'all' ? isError : catalog.isError) ? 'Failed to load products' : '';

  // Daraz is optional: if it is not configured the lookup just fails and no badges show.
  const pageIds = products.map((p) => p._id);
  const { data: darazListings } = useQuery({
    queryKey: ['daraz', 'listings', pageIds],
    queryFn: () => getDarazListings(pageIds),
    enabled: pageIds.length > 0,
    retry: false,
  });

  // Only needed to work out a listing's commission, so it is fetched once something on the page is on Daraz.
  const hasListings = Object.keys(darazListings ?? {}).length > 0;
  const { data: darazLeaves } = useQuery({
    queryKey: ['daraz', 'categories'],
    queryFn: getDarazCategories,
    enabled: hasListings,
    retry: false,
    staleTime: 30 * 60_000,
  });

  /**
   * Sends a changed price (rupees as typed here) and/or stock to the product's Daraz listing, if it has one.
   * Throws Daraz's own message when it refuses; resolves with a note when part of the change could not be sent.
   */
  async function pushToDaraz(id: string, change: { rupees?: number; stock?: number | null }) {
    const listing = darazListings?.[id];
    if (!listing) return '';
    const offer = darazOfferFor({ ...change, categoryId: listing.categoryId, leaves: darazLeaves });
    if (hasOffer(offer)) await updateDarazOffer(id, { price: offer.price, quantity: offer.quantity });
    return offer.note ?? '';
  }

  /** The same, for edits made in the table: the store change is already saved, so Daraz trouble is only reported. */
  async function syncDaraz(id: string, change: { rupees?: number; stock?: number | null }) {
    if (!darazListings?.[id]) return;
    try {
      const note = await pushToDaraz(id, change);
      toast.success(note ? `Daraz updated, but ${note}` : 'Daraz updated too');
    } catch (err) {
      toast.error(`Saved on QuantumStore, but Daraz did not take it: ${getErrorMessage(err, 'Daraz refused the update')}`);
    }
  }

  async function invalidate() {
    await queryClient.invalidateQueries({ queryKey: queryKeys.products.all });
  }

  // Products the old backend sync pulled in from audionic.co (they carry a `source`). Products made by the Launcher's
  // Audionic page have the same brand but no `source`, so they are never offered for deletion here.
  const { data: audionicProducts = [] } = useAudionicProducts();
  const importedProducts = audionicProducts.filter((product) => product.source?.store === 'audionic');

  async function removeImported() {
    const ok = await confirm(
      `This permanently deletes ${importedProducts.length} products that were imported automatically from audionic.co. ` +
        'Products you published yourself are not touched.',
      { title: 'Delete the imported Audionic products?', confirmLabel: 'Delete them', tone: 'danger' },
    );
    if (!ok) return;
    setRemovingImported(true);
    try {
      const ids = importedProducts.map((product) => product._id);
      for (let i = 0; i < ids.length; i += 100) {
        await api.post('/products/bulk', { ids: ids.slice(i, i + 100), action: 'delete' });
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.products.all });
      toast.success(`${ids.length} imported products deleted`);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not delete the imported products'));
      await queryClient.invalidateQueries({ queryKey: queryKeys.products.all });
    } finally {
      setRemovingImported(false);
    }
  }

  function startEdit(product: Product) {
    setEditingId(product._id);
    setForm(productToForm(product, pkrRate));
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
      const original = products.find((product) => product._id === editingId);
      await api.put(`/products/${editingId}`, buildProductPayload(form, pkrRate));
      await invalidate();
      toast.success('Product saved');
      if (darazListings?.[editingId]) {
        // The Daraz listing is separate, so the images, and the price or stock if they changed, are sent there as well.
        // The form stays open if Daraz refuses, with the reason on screen, and pressing Update product again retries.
        const before = original ? productToForm(original, pkrRate) : null;
        try {
          const sent = await updateDarazImages(editingId, form.images.map((image) => image.url));
          toast.success(`${sent.count} image${sent.count === 1 ? '' : 's'} sent to Daraz`);
          const stock = form.stock.trim() === '' ? null : Number(form.stock);
          const note = await pushToDaraz(editingId, {
            rupees: !before || before.price !== form.price ? Number(form.price) : undefined,
            stock: !before || before.stock !== form.stock ? stock : undefined,
          });
          if (note) toast.error(`Daraz: ${note}`);
        } catch (err) {
          setError(`Saved on QuantumStore, but Daraz did not take the update: ${getErrorMessage(err, 'Daraz refused the update')}`);
          return;
        }
      }
      resetForm();
    } catch (err) {
      setError(getErrorMessage(err, 'Could not save product'));
    } finally {
      setSaving(false);
    }
  }

  /**
   * Takes the given products off Daraz before they are deleted here, so no listing is left behind. When Daraz
   * refuses, the seller decides whether to delete from QuantumStore anyway. Returns false to stop the delete.
   */
  async function removeFromDarazFirst(ids: string[]) {
    const listed = ids.filter((id) => darazListings?.[id]);
    const failures: string[] = [];
    for (const id of listed) {
      try {
        await removeFromDaraz({ quantumProductId: id });
      } catch (err) {
        failures.push(getErrorMessage(err, 'Daraz refused the request'));
      }
    }
    if (listed.length) await queryClient.invalidateQueries({ queryKey: ['daraz', 'listings'] });
    if (!failures.length) return true;
    return confirm(
      `Daraz did not remove ${failures.length === 1 ? 'the listing' : `${failures.length} listings`}: ${failures[0]}. ` +
        'Delete from QuantumStore anyway? The Daraz listing stays and can be removed from the "Listed on Daraz" list below.',
      { title: 'Could not remove from Daraz', confirmLabel: 'Delete anyway', tone: 'danger' },
    );
  }

  async function handleDelete(id: string) {
    const ok = await confirm('This will permanently remove the product from your catalog.', {
      title: 'Delete this product?',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      if (!(await removeFromDarazFirst([id]))) return;
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
      return;
    }
    await syncDaraz(id, { stock });
  }

  async function savePrice(id: string, rupees: number) {
    try {
      await api.put(`/products/${id}`, { price: rupeesToStored(rupees, pkrRate) });
      toast.success('Price updated');
      await invalidate();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Price update failed'));
      await invalidate();
      return;
    }
    await syncDaraz(id, { rupees });
  }

  async function setSelectedStock() {
    const raw = bulkStock.trim();
    const stock = raw === '' ? null : Number(raw);
    if (stock !== null && !(Number.isInteger(stock) && stock >= 0)) {
      toast.error('Stock must be a whole number, 0 or more (blank = untracked)');
      return;
    }
    const failed: string[] = [];
    for (const id of selected) {
      try {
        await api.patch(`/products/${id}/stock`, { stock });
        if (darazListings?.[id]) await pushToDaraz(id, { stock });
      } catch (err) {
        failed.push(getErrorMessage(err, 'failed'));
      }
    }
    await invalidate();
    if (failed.length) toast.error(`${failed.length} of ${selected.length} not fully updated: ${failed[0]}`);
    else toast.success(`Stock set for ${selected.length} product${selected.length === 1 ? '' : 's'}`);
    setSelected([]);
    setBulkStock('');
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
      if (!(await removeFromDarazFirst(selected))) return;
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
      <p className="muted">
        Change a price or stock right in the table. Products listed on Daraz get the new price (with the commission added)
        and stock there too.
      </p>

      <div className="admin-toolbar">
        <span className="muted">
          {importedProducts.length > 0
            ? `${importedProducts.length} products were imported automatically from audionic.co — they are not products you entered.`
            : 'Edit or remove the products you published.'}
        </span>
        <div className="admin-quick">
          <Link to="/publish" className="btn btn-primary">
            Publish new product
          </Link>
          {importedProducts.length > 0 && (
            <button type="button" className="btn btn-secondary" disabled={removingImported} onClick={removeImported}>
              {removingImported ? 'Deleting…' : `Delete the ${importedProducts.length} imported products`}
            </button>
          )}
        </div>
      </div>

      <div className="products-filters">
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
        <select
          className="input"
          aria-label="Brand"
          value={brandFilter}
          onChange={(e) => {
            setBrandFilter(e.target.value);
            setPage(1);
            setSelected([]);
          }}
        >
          <option value="All">All brands</option>
          {(facets?.brands ?? []).map((brand) => (
            <option key={brand} value={brand}>
              {brand}
            </option>
          ))}
        </select>
        <select
          className="input"
          aria-label="Sort"
          value={sort}
          onChange={(e) => {
            setSort(e.target.value as typeof sort);
            setPage(1);
          }}
        >
          {SORTS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          className="input"
          aria-label="Products per page"
          value={pageSize}
          onChange={(e) => {
            setPageSize(Number(e.target.value) as typeof pageSize);
            setPage(1);
            setSelected([]);
          }}
        >
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size} per page
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
            {counts && ` (${counts.stock[value]})`}
          </button>
        ))}
        {allListings &&
          (
            [
              ['all', 'All shops'],
              ['daraz', 'On Daraz'],
              ['store', 'QuantumStore only'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`chip ${channel === value ? 'active' : ''}`}
              onClick={() => {
                setChannel(value);
                setPage(1);
                setSelected([]);
              }}
            >
              {label}
              {counts && ` (${counts.channel[value]})`}
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
            <button type="submit" className="btn btn-primary" disabled={saving || uploading || !rateReady}>
              {saving ? 'Saving…' : 'Update product'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={resetForm}>
              Cancel edit
            </button>
          </div>
          {darazListings?.[editingId] && (
            <p className="muted">
              This product is also listed on Daraz (item {darazListings[editingId].itemId}). Saving sends the images to
              Daraz, and the price (with the commission added) and stock if you changed them; other changes (name,
              description) are not sent — edit those in Daraz Seller Center.
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
          <input
            className="input qty-input"
            type="number"
            min="0"
            placeholder="Stock"
            aria-label="Stock for the selected products"
            value={bulkStock}
            onChange={(e) => setBulkStock(e.target.value)}
          />
          <button type="button" className="btn btn-ghost" onClick={setSelectedStock}>
            Set stock
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
                <td data-label="Price">
                  <input
                    key={`${product._id}-${product.price}`}
                    className="input qty-input price-input"
                    type="number"
                    min="1"
                    step="any"
                    aria-label={`Price in rupees for ${product.name}`}
                    defaultValue={storedToRupees(product.price, pkrRate)}
                    disabled={!rateReady}
                    onBlur={(e) => {
                      const next = Number(e.target.value);
                      if (!(next > 0)) {
                        e.target.value = String(storedToRupees(product.price, pkrRate));
                      } else if (next !== storedToRupees(product.price, pkrRate)) {
                        savePrice(product._id, next);
                      }
                    }}
                  />
                </td>
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
        <button type="button" className="btn btn-ghost" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>
          Prev
        </button>
        <span className="muted">
          Page {currentPage} / {pages}
        </span>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={currentPage >= pages}
          onClick={() => setPage(currentPage + 1)}
        >
          Next
        </button>
      </div>

      <DarazListingsCard />
    </div>
  );
}
