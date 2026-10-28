import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../api/client';
import { getDarazAttributes, getDarazCategories, publishToDaraz, type DarazPublishResult } from '../../api/daraz';
import type { Product } from '../../api/types';
import { addCommission, commissionFor, groupOf } from '../../features/daraz/categoryGroups';
import DarazAuthPrompt from '../../features/daraz/DarazAuthPrompt';
import DarazPanel from '../../features/daraz/DarazPanel';
import { initialDaraz, saveDefaults, slugSku, type DarazForm } from '../../features/daraz/darazForm';
import { useDarazConnection } from '../../features/daraz/useDarazConnection';
import { ensureStoreCategory } from '../../features/products/ensureCategory';
import { ensurePublicImages } from '../../features/products/publicImages';
import ProductFormFields from '../../features/products/ProductFormFields';
import {
  buildProductPayload,
  emptyForm,
  parseSpecs,
  type ProductForm,
} from '../../features/products/productForm';
import { queryKeys } from '../../hooks/queryKeys';
import { useProductCategoryNames } from '../../hooks/useProducts';
import { getErrorMessage } from '../../utils/errors';

type StepState = { status: 'idle' | 'running' | 'done' | 'failed' | 'skipped'; message?: string };

const STEP_TEXT: Record<StepState['status'], string> = {
  idle: 'Waiting',
  running: 'Working…',
  done: 'Published',
  failed: 'Failed',
  skipped: 'Not selected',
};

function StepRow({ label, step }: { label: string; step: StepState }) {
  return (
    <li className={`publish-step publish-step-${step.status}`}>
      <strong>{label}</strong> — {STEP_TEXT[step.status]}
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
    finishing,
    connect: connectDaraz,
    finishWithCode,
  } = useDarazConnection();
  const darazReady = Boolean(status?.configured && status.connected);
  const darazOn = toDaraz && darazReady;

  const leavesQuery = useQuery({
    queryKey: ['daraz', 'categories'],
    queryFn: getDarazCategories,
    enabled: darazOn,
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
  const attributesQuery = useQuery({
    queryKey: ['daraz', 'attributes', daraz.categoryId],
    queryFn: () => getDarazAttributes(daraz.categoryId as number),
    enabled: darazOn && daraz.categoryId !== null,
    retry: false,
  });

  // The store price is already in rupees; Daraz gets it with the category's commission added on top.
  const commission = daraz.categoryLabel ? commissionFor(groupOf(daraz.categoryLabel)) : null;
  const autoPrice = form.price ? String(addCommission(Number(form.price), commission)) : '';
  const autoSku = slugSku(form.name, skuSuffix.current);

  const showResult = storeStep.status !== 'idle' || darazStep.status !== 'idle';
  const canRetryDaraz = darazStep.status === 'failed' && !busy;
  const allDone =
    (storeStep.status === 'done' || storeStep.status === 'skipped') &&
    (darazStep.status === 'done' || darazStep.status === 'skipped');
  const locked = busy || allDone;

  function validate(): string {
    if (!toStore && !toDaraz) return 'Choose at least one place to publish to';
    if (!form.images.length) return 'At least one product image is required';
    if (toDaraz && !darazReady) return 'Daraz is not connected — press Connect Daraz above, or untick Daraz';
    if (darazOn) {
      if (daraz.categoryId === null) return 'Pick a Daraz category';
      if (!(Number(daraz.price || autoPrice) > 0)) return 'Enter a price for Daraz';
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

  async function runDaraz(quantumProductId: string | undefined, imageUrls: string[]) {
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
        price: Number(daraz.price || autoPrice),
        specialPrice: daraz.specialPrice ? Number(daraz.specialPrice) : null,
        images: imageUrls,
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

    // Daraz fetches images from the internet, so anything not on a public https address is uploaded again first.
    let images = form.images;
    let imageProblem = '';
    try {
      const fixed = await ensurePublicImages(images, {
        download: async (url) => (await api.get<Blob>(url, { responseType: 'blob', baseURL: '' })).data,
        upload: async (file) => {
          const body = new FormData();
          body.append('image', file);
          const { data } = await api.post<{ url: string; thumbnail?: string }>('/uploads', body, {
            headers: { 'Content-Type': 'multipart/form-data' },
          });
          return data;
        },
      });
      if (fixed.changed) {
        images = fixed.images;
        setForm((prev) => ({ ...prev, images: fixed.images }));
      }
    } catch (err) {
      // QuantumStore still gets the product; only Daraz needs public images, so it is the one that reports this.
      imageProblem = getErrorMessage(err, err instanceof Error ? err.message : 'Could not prepare the images');
    }

    let productId = createdProduct?._id;
    if (toStore && !createdProduct) {
      setStoreStep({ status: 'running' });
      try {
        // With Daraz on, the Daraz category group decides the store category, so it is only picked once.
        const category =
          darazOn && daraz.categoryId !== null
            ? await ensureStoreCategory(groupOf(daraz.categoryLabel), categories)
            : form.category;
        const { data } = await api.post<Product>('/products', buildProductPayload({ ...form, images, category }));
        setCreatedProduct(data);
        productId = data._id;
        setStoreStep({ status: 'done', message: 'Product created' });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.products.all }),
          queryClient.invalidateQueries({ queryKey: queryKeys.categories }),
        ]);
      } catch (err) {
        setStoreStep({ status: 'failed', message: getErrorMessage(err, 'Could not create the product') });
        setBusy(false);
        return; // nothing was created anywhere, so Daraz is not attempted
      }
    } else if (!toStore) {
      setStoreStep({ status: 'skipped' });
    }

    if (darazOn && imageProblem) {
      setDarazStep({ status: 'failed', message: imageProblem });
    } else if (darazOn) {
      await runDaraz(productId, images.map((i) => i.url));
    } else {
      setDarazStep({ status: 'skipped' });
    }
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
        Fill the form once. Images go to Cloudinary through the QuantumStore backend, and the product is created on
        QuantumStore and Daraz together.
      </p>

      <form className="admin-form" onSubmit={handlePublish}>
        <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0, display: 'contents' }}>
          <ProductFormFields
            form={form}
            setForm={setForm}
            categories={categories}
            hideCategory={darazOn}
            onError={setError}
            onUploadingChange={setUploading}
          />

          <h2>Publish to</h2>
          <div className="targets">
            <label className="target-card">
              <input type="checkbox" checked={toStore} onChange={(e) => setToStore(e.target.checked)} />
              <span>
                <strong>QuantumStore</strong>
                <small>Your own shop. Images are stored on Cloudinary.</small>
              </span>
            </label>
            <label className="target-card">
              <input type="checkbox" checked={toDaraz} onChange={(e) => setToDaraz(e.target.checked)} />
              <span>
                <strong>Daraz</strong>
                <small>
                  {darazReady
                    ? `Listed on Seller Center${status?.account ? ` as ${status.account}` : ''}.`
                    : 'Needs a one-time connection to your seller account.'}
                </small>
              </span>
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
            <DarazAuthPrompt
              authUrl={authUrl}
              waiting={waiting}
              connectError={connectError}
              finishing={finishing}
              redirectUri={status?.redirectUri}
              showPaste={Boolean(status?.configured)}
              onFinish={finishWithCode}
            />
          )}

          {darazOn && (
            <DarazPanel
              daraz={daraz}
              setDaraz={setDaraz}
              productName={form.name}
              productBrand={form.brand}
              productDescription={form.description}
              aiConfigured={Boolean(status?.aiConfigured)}
              storePrice={form.price}
              storeStock={form.stock}
              commission={commission}
              autoPrice={autoPrice}
              autoSku={autoSku}
              account={status?.account}
              storeCategory={toStore && daraz.categoryId !== null ? groupOf(daraz.categoryLabel) : ''}
              leaves={leavesQuery.data}
              leavesLoading={leavesQuery.isLoading}
              leavesError={leavesQuery.error ? getErrorMessage(leavesQuery.error, 'Could not load Daraz categories') : ''}
              attributes={attributesQuery.data}
              attributesLoading={attributesQuery.isLoading}
            />
          )}
        </fieldset>

        <div className="publish-bar">
          {error && (
            <p className="form-error" role="alert" style={{ margin: 0 }}>
              {error}
            </p>
          )}
          {showResult && (
            <ul className="publish-steps" aria-live="polite">
              <StepRow label="QuantumStore" step={storeStep} />
              <StepRow label="Daraz" step={darazStep} />
            </ul>
          )}
          {createdProduct && (
            <p className="muted" style={{ margin: 0 }}>
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
        </div>
      </form>
    </div>
  );
}
