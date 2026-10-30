import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { descriptionForDaraz } from '../../../shared/darazText';
import api from '../../api/client';
import {
  getDarazAttributes,
  getDarazCategories,
  prepareDarazListing,
  publishToDaraz,
  type DarazPublishResult,
} from '../../api/daraz';
import type { Product } from '../../api/types';
import { grossUpPrice, commissionFor, groupOf } from '../../features/daraz/categoryGroups';
import DarazAuthPrompt from '../../features/daraz/DarazAuthPrompt';
import DarazPanel from '../../features/daraz/DarazPanel';
import {
  applyPrepared,
  darazPrice,
  darazProblem,
  initialDaraz,
  slugSku,
  type DarazForm,
} from '../../features/daraz/darazForm';
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
import { usePkrRate } from '../../hooks/usePkrRate';
import { useProductCategoryNames } from '../../hooks/useProducts';
import { getErrorMessage } from '../../utils/errors';

type StepState = { status: 'idle' | 'running' | 'done' | 'failed' | 'skipped'; message?: string };

const STEP_TEXT: Record<StepState['status'], string> = {
  idle: 'Waiting',
  running: 'Working…',
  done: 'Published',
  failed: 'Failed',
  skipped: 'Not connected',
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
  const [showDaraz, setShowDaraz] = useState(false);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('');
  const [storeStep, setStoreStep] = useState<StepState>({ status: 'idle' });
  const [darazStep, setDarazStep] = useState<StepState>({ status: 'idle' });
  const [createdProduct, setCreatedProduct] = useState<Product | null>(null);
  const [darazResult, setDarazResult] = useState<DarazPublishResult | null>(null);
  const skuSuffix = useRef(Math.random().toString(36).slice(2, 6).toUpperCase());

  const { rate: pkrRate, ready: rateReady } = usePkrRate();
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
  // One publish goes to every place that is set up: Daraz is included as soon as it is connected.
  const darazOn = Boolean(status?.configured && status.connected);

  const leavesQuery = useQuery({
    queryKey: ['daraz', 'categories'],
    queryFn: getDarazCategories,
    enabled: darazOn && showDaraz,
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
  const attributesQuery = useQuery({
    queryKey: ['daraz', 'attributes', daraz.categoryId],
    queryFn: () => getDarazAttributes(daraz.categoryId as number),
    enabled: darazOn && daraz.categoryId !== null,
    retry: false,
  });

  // QuantumStore gets the price exactly as entered; Daraz gets the price that leaves it after Daraz's commission.
  const commission = daraz.categoryLabel ? commissionFor(groupOf(daraz.categoryLabel)) : null;
  const autoPrice = form.price ? String(grossUpPrice(Number(form.price), commission)) : '';
  const autoSku = slugSku(form.name, skuSuffix.current);

  const showResult = storeStep.status !== 'idle' || darazStep.status !== 'idle';
  const canRetryDaraz = darazStep.status === 'failed' && !busy;
  const allDone =
    storeStep.status === 'done' && (darazStep.status === 'done' || darazStep.status === 'skipped');
  const locked = busy || allDone;

  function validate(): string {
    if (!form.images.length) return 'At least one product image is required';
    if (darazOn) {
      const quantity = daraz.quantity || form.stock;
      if (quantity === '' || !Number.isInteger(Number(quantity))) {
        return 'Enter a stock quantity — Daraz requires a number';
      }
    }
    return '';
  }

  async function runDaraz(quantumProductId: string | undefined, imageUrls: string[], plan: DarazForm) {
    setDarazStep({ status: 'running' });
    try {
      const result = await publishToDaraz({
        quantumProductId,
        categoryId: plan.categoryId as number,
        name: form.name,
        description: descriptionForDaraz({
          description: form.description,
          aiDescription: plan.aiDescription,
          specs: parseSpecs(form.specsText),
        }),
        brand: form.brand,
        sellerSku: plan.sellerSku.trim() || autoSku,
        quantity: Number(plan.quantity || form.stock),
        price: darazPrice(plan, form.price),
        specialPrice: plan.specialPrice ? Number(plan.specialPrice) : null,
        images: imageUrls,
        specs: parseSpecs(form.specsText),
        package: {
          weight: Number(plan.weight),
          length: Number(plan.length),
          width: Number(plan.width),
          height: Number(plan.height),
          content: plan.content.trim() || form.name,
        },
        attributes: plan.attributes,
      });
      setDarazResult(result);
      setDarazStep({
        status: 'done',
        message: `Item ${result.itemId}${
          result.changes?.length ? ` · ${result.changes.join(' · ')}` : result.brandReplaced ? ' · listed as No Brand' : ''
        }`,
      });
      return true;
    } catch (err) {
      setDarazStep({ status: 'failed', message: getErrorMessage(err, 'Daraz rejected the listing') });
      setShowDaraz(true); // whatever Daraz asked for is in that section
      return false;
    }
  }

  /** Lets the AI choose the category and fill everything else Daraz needs. Returns the plan, or '' + why not. */
  async function prepareDaraz(): Promise<{ plan: DarazForm; problem: string }> {
    setPhase('Writing the Daraz listing…');
    let plan = daraz;
    let aiProblem = '';
    try {
      const prepared = await prepareDarazListing({
        name: form.name.trim(),
        brand: form.brand.trim(),
        description: form.description.trim(),
        specs: parseSpecs(form.specsText),
        categoryId: daraz.categoryId,
        attributes: daraz.attributes,
      });
      plan = applyPrepared(daraz, prepared);
      setDaraz(plan);
    } catch (err) {
      aiProblem = getErrorMessage(err, 'The AI could not prepare the Daraz listing');
    }
    const problem = darazProblem(plan, form.price, form.stock);
    return { plan, problem: problem && aiProblem ? `${problem}. (${aiProblem})` : problem };
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

    // The AI fills only what is still empty, so a retry after a Daraz failure keeps everything already in the form.
    let plan = daraz;
    if (darazOn) {
      const prepared = await prepareDaraz();
      plan = prepared.plan;
      if (prepared.problem) {
        // Nothing new has been created, so the seller can fix it and press the button again.
        setError(prepared.problem);
        setShowDaraz(true);
        setPhase('');
        setBusy(false);
        return;
      }
    }

    setPhase('Publishing…');
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
    if (!createdProduct) {
      setStoreStep({ status: 'running' });
      try {
        // With Daraz on, the Daraz category group decides the store category.
        const category = darazOn ? await ensureStoreCategory(groupOf(plan.categoryLabel), categories) : form.category;
        const { data } = await api.post<Product>('/products', buildProductPayload({ ...form, images, category }, pkrRate));
        setCreatedProduct(data);
        productId = data._id;
        setStoreStep({ status: 'done', message: 'Product created' });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.products.all }),
          queryClient.invalidateQueries({ queryKey: queryKeys.categories }),
        ]);
      } catch (err) {
        setStoreStep({ status: 'failed', message: getErrorMessage(err, 'Could not create the product') });
        setPhase('');
        setBusy(false);
        return; // nothing was created anywhere, so Daraz is not attempted
      }
    }

    if (darazOn && imageProblem) {
      setDarazStep({ status: 'failed', message: imageProblem });
    } else if (darazOn) {
      await runDaraz(productId, images.map((i) => i.url), plan);
    } else {
      setDarazStep({ status: 'skipped', message: 'connect Daraz to publish there too' });
    }
    setPhase('');
    setBusy(false);
  }

  function startAnother() {
    setForm({ ...emptyForm, category: categories[0] || 'Laptops' });
    setDaraz(initialDaraz());
    setShowDaraz(false);
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
        Fill in the product once and press Publish. It is added to QuantumStore{darazOn ? ' and Daraz' : ''}; the AI
        picks the Daraz category and writes everything else Daraz asks for.
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

          {!darazOn && (
            <div className="admin-quick" style={{ alignItems: 'center' }}>
              <p className="muted" style={{ margin: 0 }}>
                {statusLoading
                  ? 'Checking the Daraz connection…'
                  : statusError
                    ? `Could not check the Daraz connection: ${getErrorMessage(statusError, 'unknown error')}`
                    : status && !status.configured
                      ? 'Daraz app credentials are missing: set DARAZ_APP_KEY, DARAZ_APP_SECRET and DARAZ_REDIRECT_URI in launcher/.env and restart the Launcher. Until then products go to QuantumStore only.'
                      : 'Daraz is not connected yet, so this publishes to QuantumStore only. Connect it once to publish to both.'}
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
          {!darazOn && (
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
            <details
              className="daraz-details"
              open={showDaraz}
              onToggle={(e) => setShowDaraz((e.currentTarget as HTMLDetailsElement).open)}
            >
              <summary>
                <strong>Daraz details</strong>
                <span className="muted">
                  {' '}
                  {daraz.categoryLabel
                    ? `· ${daraz.categoryLabel}`
                    : '· filled in automatically when you publish — open to review or change'}
                </span>
              </summary>
              <DarazPanel
                daraz={daraz}
                setDaraz={setDaraz}
                productName={form.name}
                productBrand={form.brand}
                productDescription={form.description}
                aiConfigured={Boolean(status?.aiConfigured)}
                storeStock={form.stock}
                storePrice={form.price}
                commission={commission}
                autoPrice={autoPrice}
                autoSku={autoSku}
                account={status?.account}
                storeCategory={daraz.categoryId !== null ? groupOf(daraz.categoryLabel) : ''}
                leaves={leavesQuery.data}
                leavesLoading={leavesQuery.isLoading}
                leavesError={leavesQuery.error ? getErrorMessage(leavesQuery.error, 'Could not load Daraz categories') : ''}
                attributes={attributesQuery.data}
                attributesLoading={attributesQuery.isLoading}
              />
            </details>
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
              <button type="submit" className="btn btn-primary" disabled={busy || uploading || !rateReady}>
                {busy ? phase || 'Publishing…' : canRetryDaraz ? 'Retry Daraz' : 'Publish'}
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
