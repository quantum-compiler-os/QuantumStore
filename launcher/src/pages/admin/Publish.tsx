import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../api/client';
import {
  getDarazAttributes,
  getDarazCategories,
  publishToDaraz,
  type DarazAttribute,
  type DarazPublishResult,
} from '../../api/daraz';
import type { Product } from '../../api/types';
import DarazAuthPrompt from '../../features/daraz/DarazAuthPrompt';
import { useDarazConnection } from '../../features/daraz/useDarazConnection';
import ProductFormFields from '../../features/products/ProductFormFields';
import {
  buildProductPayload,
  emptyForm,
  parseSpecs,
  type ProductForm,
} from '../../features/products/productForm';
import { queryKeys } from '../../hooks/queryKeys';
import { useProductCategoryNames } from '../../hooks/useProducts';
import { useSettings } from '../../hooks/useSettings';
import { getErrorMessage } from '../../utils/errors';

const DEFAULTS_KEY = 'ql_daraz_defaults';

type DarazForm = {
  categoryId: number | null;
  categoryLabel: string;
  sellerSku: string;
  price: string;
  specialPrice: string;
  quantity: string;
  weight: string;
  length: string;
  width: string;
  height: string;
  content: string;
  attributes: Record<string, string>;
};

type Remembered = Pick<DarazForm, 'categoryId' | 'categoryLabel' | 'weight' | 'length' | 'width' | 'height'>;

function loadDefaults(): Partial<Remembered> {
  try {
    return JSON.parse(localStorage.getItem(DEFAULTS_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveDefaults(d: DarazForm) {
  try {
    const value: Remembered = {
      categoryId: d.categoryId,
      categoryLabel: d.categoryLabel,
      weight: d.weight,
      length: d.length,
      width: d.width,
      height: d.height,
    };
    localStorage.setItem(DEFAULTS_KEY, JSON.stringify(value));
  } catch {
    /* private mode — remembering is a convenience only */
  }
}

function initialDaraz(): DarazForm {
  const saved = loadDefaults();
  return {
    categoryId: saved.categoryId ?? null,
    categoryLabel: saved.categoryLabel ?? '',
    sellerSku: '',
    price: '',
    specialPrice: '',
    quantity: '',
    weight: saved.weight ?? '',
    length: saved.length ?? '',
    width: saved.width ?? '',
    height: saved.height ?? '',
    content: '',
    attributes: {},
  };
}

type StepState = { status: 'idle' | 'running' | 'done' | 'failed' | 'skipped'; message?: string };

function slugSku(name: string, suffix: string) {
  const base = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return `${base || 'PRODUCT'}-${suffix}`;
}

function StepRow({ label, step }: { label: string; step: StepState }) {
  const text =
    step.status === 'running'
      ? 'Working…'
      : step.status === 'done'
        ? 'Published'
        : step.status === 'failed'
          ? 'Failed'
          : step.status === 'skipped'
            ? 'Not selected'
            : 'Waiting';
  return (
    <li className={`publish-step publish-step-${step.status}`}>
      <strong>{label}</strong> — {text}
      {step.message && <span className="muted"> · {step.message}</span>}
    </li>
  );
}

export default function Publish() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [daraz, setDaraz] = useState<DarazForm>(initialDaraz);
  const [toStore, setToStore] = useState(true);
  const [toDaraz, setToDaraz] = useState(true);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [categorySearch, setCategorySearch] = useState('');
  const [showOptional, setShowOptional] = useState(false);
  const [storeStep, setStoreStep] = useState<StepState>({ status: 'idle' });
  const [darazStep, setDarazStep] = useState<StepState>({ status: 'idle' });
  const [createdProduct, setCreatedProduct] = useState<Product | null>(null);
  const [darazResult, setDarazResult] = useState<DarazPublishResult | null>(null);
  const skuSuffix = useRef(Math.random().toString(36).slice(2, 6).toUpperCase());

  const { data: categoryNames } = useProductCategoryNames();
  const categories = categoryNames?.length ? categoryNames : ['Laptops'];

  const {
    status,
    statusError,
    statusLoading,
    refetchStatus,
    connecting,
    waiting,
    authUrl,
    connectError,
    connect: connectDaraz,
  } = useDarazConnection();
  const darazReady = Boolean(status?.configured && status.connected);
  const { data: settings } = useSettings();
  // Store prices are in the base currency; Daraz wants rupees.
  const baseCurrency = String(settings?.baseCurrency || 'USD');
  const pkrRate = baseCurrency === 'PKR' ? 1 : settings?.currencies?.find((c) => c.code === 'PKR')?.rate || 1;
  const convertedPrice = form.price ? String(Math.round(Number(form.price) * pkrRate * 100) / 100) : '';
  const darazOn = toDaraz && darazReady;

  const { data: leaves } = useQuery({
    queryKey: ['daraz', 'categories'],
    queryFn: getDarazCategories,
    enabled: darazOn,
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
  const { data: attributes } = useQuery({
    queryKey: ['daraz', 'attributes', daraz.categoryId],
    queryFn: () => getDarazAttributes(daraz.categoryId as number),
    enabled: darazOn && daraz.categoryId !== null,
    retry: false,
  });

  const matches = useMemo(() => {
    const q = categorySearch.trim().toLowerCase();
    if (!q || !leaves) return [];
    return leaves.filter((l) => l.path.toLowerCase().includes(q)).slice(0, 40);
  }, [leaves, categorySearch]);

  const showResult = storeStep.status !== 'idle' || darazStep.status !== 'idle';
  const canRetryDaraz = darazStep.status === 'failed' && !busy;
  const allDone =
    (storeStep.status === 'done' || storeStep.status === 'skipped') &&
    (darazStep.status === 'done' || darazStep.status === 'skipped');
  const locked = busy || allDone;
  const autoSku = slugSku(form.name, skuSuffix.current);
  const visibleAttributes = (attributes || []).filter((a) => a.mandatory || showOptional);

  function setDarazField<K extends keyof DarazForm>(key: K, value: DarazForm[K]) {
    setDaraz((prev) => ({ ...prev, [key]: value }));
  }

  function renderAttribute(attr: DarazAttribute) {
    const value = daraz.attributes[attr.name] || '';
    const set = (v: string) => setDaraz((prev) => ({ ...prev, attributes: { ...prev.attributes, [attr.name]: v } }));
    return (
      <label key={attr.name}>
        {attr.label}
        {attr.mandatory ? ' *' : ''}
        {attr.options.length > 0 && attr.inputType !== 'multiSelect' ? (
          <select className="input" value={value} onChange={(e) => set(e.target.value)}>
            <option value="">Select…</option>
            {attr.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        ) : (
          <input className="input" value={value} onChange={(e) => set(e.target.value)} />
        )}
      </label>
    );
  }

  function validate(): string {
    if (!toStore && !toDaraz) return 'Choose at least one place to publish to';
    if (!form.images.length) return 'At least one product image is required';
    if (toDaraz && !darazReady) return 'Daraz is not connected — press Connect Daraz above, or untick Daraz';
    if (darazOn) {
      if (daraz.categoryId === null) return 'Pick a Daraz category';
      if (!(Number(daraz.price || convertedPrice) > 0)) return 'Enter a price for Daraz';
      const quantity = daraz.quantity || form.stock;
      if (quantity === '' || !Number.isInteger(Number(quantity))) {
        return 'Enter a stock quantity (it is required by Daraz)';
      }
      for (const [label, value] of [
        ['weight', daraz.weight],
        ['length', daraz.length],
        ['width', daraz.width],
        ['height', daraz.height],
      ] as const) {
        if (!(Number(value) > 0)) return `Enter the package ${label} for Daraz`;
      }
    }
    return '';
  }

  async function runDaraz(quantumProductId: string | undefined) {
    setDarazStep({ status: 'running' });
    saveDefaults(daraz);
    try {
      const result = await publishToDaraz({
        quantumProductId,
        categoryId: daraz.categoryId as number,
        name: form.name,
        description: form.description,
        brand: form.brand,
        sellerSku: daraz.sellerSku.trim() || autoSku,
        quantity: Number(daraz.quantity || form.stock),
        price: Number(daraz.price || convertedPrice),
        specialPrice: daraz.specialPrice ? Number(daraz.specialPrice) : null,
        images: form.images.map((i) => i.url),
        specs: parseSpecs(form.specsText),
        package: {
          weight: Number(daraz.weight),
          length: Number(daraz.length),
          width: Number(daraz.width),
          height: Number(daraz.height),
          content: daraz.content.trim() || form.name,
        },
        attributes: daraz.attributes,
      });
      setDarazResult(result);
      setDarazStep({ status: 'done', message: `Item ${result.itemId}` });
      return true;
    } catch (err) {
      setDarazStep({ status: 'failed', message: getErrorMessage(err, 'Daraz rejected the listing') });
      return false;
    }
  }

  async function handlePublish(e: FormEvent) {
    e.preventDefault();
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setError('');
    setBusy(true);

    let productId = createdProduct?._id;
    if (toStore && !createdProduct) {
      setStoreStep({ status: 'running' });
      try {
        const { data } = await api.post<Product>('/products', buildProductPayload(form));
        setCreatedProduct(data);
        productId = data._id;
        setStoreStep({ status: 'done', message: 'Images are on Cloudinary' });
        await queryClient.invalidateQueries({ queryKey: queryKeys.products.all });
      } catch (err) {
        setStoreStep({ status: 'failed', message: getErrorMessage(err, 'Could not create the product') });
        setBusy(false);
        return; // nothing was created anywhere, so Daraz is not attempted
      }
    } else if (!toStore) {
      setStoreStep({ status: 'skipped' });
    }

    if (darazOn) await runDaraz(productId);
    else setDarazStep({ status: 'skipped' });
    setBusy(false);
  }

  function startAnother() {
    setForm({ ...emptyForm, category: categories[0] || 'Laptops' });
    setDaraz((prev) => ({ ...initialDaraz(), categoryId: prev.categoryId, categoryLabel: prev.categoryLabel }));
    setStoreStep({ status: 'idle' });
    setDarazStep({ status: 'idle' });
    setCreatedProduct(null);
    setDarazResult(null);
    setError('');
    skuSuffix.current = Math.random().toString(36).slice(2, 6).toUpperCase();
  }


  return (
    <div>
      <h1>Publish product</h1>
      <p className="muted">
        Fill the form once. Images go to Cloudinary through the QuantumStore backend, and the product is created
        on QuantumStore and Daraz together.
      </p>

      <form className="admin-form" onSubmit={handlePublish}>
        <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0, display: 'contents' }}>
          <ProductFormFields
            form={form}
            setForm={setForm}
            categories={categories}
            onError={setError}
            onUploadingChange={setUploading}
          />

          <h2>Publish to</h2>
          <div className="admin-quick">
            <label className="checkbox-row">
              <input type="checkbox" checked={toStore} onChange={(e) => setToStore(e.target.checked)} />
              QuantumStore
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={toDaraz} onChange={(e) => setToDaraz(e.target.checked)} />
              Daraz
            </label>
          </div>
          {toDaraz && !darazReady && (
            <div className="admin-quick" style={{ alignItems: 'center' }}>
              <p className="muted" style={{ margin: 0 }}>
                {statusLoading
                  ? 'Checking the Daraz connection…'
                  : statusError
                    ? `Could not check the Daraz connection: ${getErrorMessage(statusError, 'unknown error')}`
                    : status && !status.configured
                      ? 'Daraz app credentials are missing: set DARAZ_APP_KEY, DARAZ_APP_SECRET and DARAZ_REDIRECT_URI in launcher/.env and restart the Launcher.'
                      : 'Daraz is not connected yet — connect it once and this box works from then on.'}
              </p>
              {statusError && (
                <button type="button" className="btn btn-ghost" onClick={() => refetchStatus()}>
                  Retry
                </button>
              )}
              {!statusLoading && !statusError && status?.configured && (
                <button type="button" className="btn btn-secondary" disabled={connecting} onClick={connectDaraz}>
                  {connecting ? 'Preparing…' : 'Connect Daraz'}
                </button>
              )}
            </div>
          )}
          {toDaraz && !darazReady && (
            <DarazAuthPrompt authUrl={authUrl} waiting={waiting} connectError={connectError} />
          )}

          {darazOn && (
            <div className="daraz-panel">
              <h2>Daraz details</h2>
              <p className="muted">
                Name, description, brand, images and specs come from the form above. Only what Daraz needs extra is
                asked here, and the package and category are remembered for next time.
              </p>

              <label>
                Daraz category *
                <input
                  className="input"
                  placeholder={daraz.categoryLabel || 'Search, e.g. headphones'}
                  value={categorySearch}
                  onChange={(e) => setCategorySearch(e.target.value)}
                />
              </label>
              {daraz.categoryId !== null && (
                <p className="muted">Selected: {daraz.categoryLabel || daraz.categoryId}</p>
              )}
              {matches.length > 0 && (
                <select
                  className="input"
                  size={Math.min(8, matches.length)}
                  onChange={(e) => {
                    const leaf = matches.find((l) => String(l.id) === e.target.value);
                    if (!leaf) return;
                    setDaraz((prev) => ({ ...prev, categoryId: leaf.id, categoryLabel: leaf.path, attributes: {} }));
                    setCategorySearch('');
                  }}
                >
                  {matches.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.path}
                    </option>
                  ))}
                </select>
              )}

              <div className="form-grid">
                <label>
                  Daraz price (Rs){baseCurrency !== 'PKR' && pkrRate !== 1 ? ` — 1 ${baseCurrency} = Rs ${pkrRate}` : ''}
                  <input
                    className="input"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder={convertedPrice || 'Converted from the price'}
                    value={daraz.price}
                    onChange={(e) => setDarazField('price', e.target.value)}
                  />
                </label>
                <label>
                  Special price (Rs, optional)
                  <input
                    className="input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={daraz.specialPrice}
                    onChange={(e) => setDarazField('specialPrice', e.target.value)}
                  />
                </label>
                <label>
                  Quantity
                  <input
                    className="input"
                    type="number"
                    min="0"
                    placeholder={form.stock || 'Required'}
                    value={daraz.quantity}
                    onChange={(e) => setDarazField('quantity', e.target.value)}
                  />
                </label>
                <label>
                  Seller SKU
                  <input
                    className="input"
                    placeholder={autoSku}
                    value={daraz.sellerSku}
                    onChange={(e) => setDarazField('sellerSku', e.target.value)}
                  />
                </label>
                <label>
                  Package weight (kg) *
                  <input
                    className="input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={daraz.weight}
                    onChange={(e) => setDarazField('weight', e.target.value)}
                  />
                </label>
                <label>
                  Length (cm) *
                  <input
                    className="input"
                    type="number"
                    min="0"
                    step="0.1"
                    value={daraz.length}
                    onChange={(e) => setDarazField('length', e.target.value)}
                  />
                </label>
                <label>
                  Width (cm) *
                  <input
                    className="input"
                    type="number"
                    min="0"
                    step="0.1"
                    value={daraz.width}
                    onChange={(e) => setDarazField('width', e.target.value)}
                  />
                </label>
                <label>
                  Height (cm) *
                  <input
                    className="input"
                    type="number"
                    min="0"
                    step="0.1"
                    value={daraz.height}
                    onChange={(e) => setDarazField('height', e.target.value)}
                  />
                </label>
                <label>
                  What&apos;s in the box
                  <input
                    className="input"
                    placeholder={form.name || 'Defaults to the product name'}
                    value={daraz.content}
                    onChange={(e) => setDarazField('content', e.target.value)}
                  />
                </label>
              </div>

              {daraz.categoryId !== null && attributes && attributes.length > 0 && (
                <>
                  <h3>Category fields</h3>
                  <div className="form-grid">{visibleAttributes.map(renderAttribute)}</div>
                  {attributes.some((a) => !a.mandatory) && (
                    <button type="button" className="text-btn" onClick={() => setShowOptional((v) => !v)}>
                      {showOptional ? 'Hide optional fields' : 'Show optional fields'}
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </fieldset>

        {error && <p className="form-error">{error}</p>}

        {showResult && (
          <ul className="publish-steps" aria-live="polite">
            <StepRow label="QuantumStore" step={storeStep} />
            <StepRow label="Daraz" step={darazStep} />
          </ul>
        )}
        {createdProduct && (
          <p className="muted">
            QuantumStore product created: <Link to="/products">view in Products</Link>
            {darazResult && ` · Daraz SKU ${darazResult.sellerSku}`}
          </p>
        )}

        <div className="admin-quick">
          {!allDone && (
            <button type="submit" className="btn btn-primary" disabled={busy || uploading}>
              {busy ? 'Publishing…' : canRetryDaraz ? 'Retry Daraz' : 'Publish'}
            </button>
          )}
          {allDone && (
            <button type="button" className="btn btn-primary" onClick={startAnother}>
              Publish another
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
