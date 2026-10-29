import { useState, type Dispatch, type SetStateAction } from 'react';
import type { DarazAttribute, DarazCategoryLeaf } from '../../api/daraz';
import CategoryPicker from './CategoryPicker';
import CategorySuggestions from './CategorySuggestions';
import type { DarazForm } from './darazForm';
import Field from './Field';

type Props = {
  daraz: DarazForm;
  setDaraz: Dispatch<SetStateAction<DarazForm>>;
  productName: string;
  productBrand: string;
  productDescription: string;
  /** True when the server has a Groq key, so category suggestions are available. */
  aiConfigured: boolean;
  /** The store price (already in rupees) and stock typed in the main form. */
  storePrice: string;
  storeStock: string;
  /** Commission (%) of the chosen category, or null when unknown. */
  commission: number | null;
  /** Store price with the commission added: what Daraz gets unless a custom price is typed. */
  autoPrice: string;
  autoSku: string;
  account: string | null | undefined;
  /** The QuantumStore category that will be used (the Daraz group), or '' when not publishing there. */
  storeCategory: string;
  leaves: DarazCategoryLeaf[] | undefined;
  leavesLoading: boolean;
  leavesError: string;
  attributes: DarazAttribute[] | undefined;
  attributesLoading: boolean;
};

const rs = (value: number) => `Rs ${value.toLocaleString()}`;

export default function DarazPanel({
  daraz,
  setDaraz,
  productName,
  productBrand,
  productDescription,
  aiConfigured,
  storePrice,
  storeStock,
  commission,
  autoPrice,
  autoSku,
  account,
  storeCategory,
  leaves,
  leavesLoading,
  leavesError,
  attributes,
  attributesLoading,
}: Props) {
  const [showOptional, setShowOptional] = useState(false);

  function set<K extends keyof DarazForm>(key: K, value: DarazForm[K]) {
    setDaraz((prev) => ({ ...prev, [key]: value }));
  }

  const store = Number(storePrice) || 0;
  const auto = Number(autoPrice) || 0;
  const custom = Number(daraz.price) || 0;
  const finalPrice = custom > 0 ? custom : auto;
  const visibleAttributes = (attributes || []).filter((a) => a.mandatory || showOptional);
  const hasOptional = (attributes || []).some((a) => !a.mandatory);

  function renderAttribute(attr: DarazAttribute) {
    const value = daraz.attributes[attr.name] || '';
    const change = (v: string) => setDaraz((prev) => ({ ...prev, attributes: { ...prev.attributes, [attr.name]: v } }));
    return (
      <Field key={attr.name} label={attr.label} required={attr.mandatory}>
        {attr.options.length > 0 && attr.inputType !== 'multiSelect' ? (
          <select className="input" value={value} onChange={(e) => change(e.target.value)}>
            <option value="">Select…</option>
            {attr.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        ) : attr.inputType === 'richText' || /(^|_)description/i.test(attr.name) ? (
          <textarea className="input" rows={3} value={value} onChange={(e) => change(e.target.value)} />
        ) : (
          <input className="input" value={value} onChange={(e) => change(e.target.value)} />
        )}
      </Field>
    );
  }

  return (
    <section className="daraz-panel" aria-label="Daraz listing">
      <header className="daraz-head">
        <div>
          <h2>Daraz listing</h2>
          <p className="muted">
            Name, description, brand, images and specs come from the form above. The AI picks the category and fills
            the rest when you press Publish; anything you type here is kept as you wrote it.
          </p>
        </div>
        {account && <span className="pill pill-ok">Connected · {account}</span>}
      </header>

      <section className="daraz-section">
        <h3>
          <span className="step-num">1</span> Category
        </h3>
        <CategorySuggestions
          name={productName}
          brand={productBrand}
          description={productDescription}
          enabled={aiConfigured}
          hasSelection={daraz.categoryId !== null}
          onPick={(leaf) =>
            setDaraz((prev) => ({ ...prev, categoryId: leaf.id, categoryLabel: leaf.path, attributes: {} }))
          }
        />
        <CategoryPicker
          leaves={leaves}
          loading={leavesLoading}
          error={leavesError}
          selectedId={daraz.categoryId}
          selectedPath={daraz.categoryLabel}
          onSelect={(leaf) =>
            setDaraz((prev) => ({ ...prev, categoryId: leaf.id, categoryLabel: leaf.path, attributes: {} }))
          }
        />
        {storeCategory && (
          <p className="field-hint" style={{ margin: 0 }}>
            On QuantumStore this product goes in the <strong>{storeCategory}</strong> category (created if it doesn&apos;t
            exist yet), so there is nothing else to choose.
          </p>
        )}
      </section>

      <section className="daraz-section">
        <h3>
          <span className="step-num">2</span> Price &amp; stock
        </h3>

        <div className="price-breakdown" aria-live="polite">
          <div className="price-line">
            <span>Your price</span>
            <strong>{store > 0 ? rs(store) : '—'}</strong>
          </div>
          {commission !== null && store > 0 ? (
            <div className="price-line">
              <span>+ {commission.toFixed(2)}% category commission</span>
              <strong>{rs(Math.max(0, auto - store))}</strong>
            </div>
          ) : (
            <div className="price-line">
              <span className="muted">
                {daraz.categoryId === null ? 'Pick a category to add its commission' : 'No commission known for this category'}
              </span>
            </div>
          )}
          <div className="price-line price-line-total">
            <span>{custom > 0 ? 'Daraz price (custom)' : 'Daraz price'}</span>
            <strong>{finalPrice > 0 ? rs(finalPrice) : '—'}</strong>
          </div>
        </div>

        <div className="daraz-grid">
          <Field
            label="Custom Daraz price (Rs)"
            hint={auto > 0 ? `Optional. Leave empty to use ${rs(auto)}.` : 'Optional. Defaults to your price plus commission.'}
          >
            <input
              className="input"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder={autoPrice || '—'}
              value={daraz.price}
              onChange={(e) => set('price', e.target.value)}
            />
          </Field>
          <Field label="Special price (Rs)" hint="Optional sale price. Must be lower than the Daraz price.">
            <input
              className="input"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={daraz.specialPrice}
              onChange={(e) => set('specialPrice', e.target.value)}
            />
          </Field>
          <Field
            label="Quantity"
            required
            hint={storeStock ? `Same as Stock above (${storeStock}). Change it to differ.` : 'Daraz needs a number — Stock above is blank.'}
          >
            <input
              className="input"
              type="number"
              inputMode="numeric"
              min="0"
              placeholder={storeStock || 'e.g. 10'}
              value={daraz.quantity}
              onChange={(e) => set('quantity', e.target.value)}
            />
          </Field>
          <Field label="Seller SKU" hint="Your own code for this item on Daraz. Generated for you.">
            <input
              className="input"
              placeholder={autoSku}
              value={daraz.sellerSku}
              onChange={(e) => set('sellerSku', e.target.value)}
            />
          </Field>
        </div>
      </section>

      <section className="daraz-section">
        <h3>
          <span className="step-num">3</span> Package
        </h3>
        <p className="field-hint" style={{ margin: 0 }}>
          Left empty, the AI estimates the packed size of one unit. Enter your own to override it.
        </p>
        <div className="daraz-grid daraz-grid-4">
          <Field label="Weight (kg)" required>
            <input
              className="input"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder="0.5"
              value={daraz.weight}
              onChange={(e) => set('weight', e.target.value)}
            />
          </Field>
          <Field label="Length (cm)" required>
            <input
              className="input"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.1"
              value={daraz.length}
              onChange={(e) => set('length', e.target.value)}
            />
          </Field>
          <Field label="Width (cm)" required>
            <input
              className="input"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.1"
              value={daraz.width}
              onChange={(e) => set('width', e.target.value)}
            />
          </Field>
          <Field label="Height (cm)" required>
            <input
              className="input"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.1"
              value={daraz.height}
              onChange={(e) => set('height', e.target.value)}
            />
          </Field>
        </div>
        <Field label="What's in the box" hint="Shown to buyers. Defaults to the product name.">
          <input
            className="input"
            placeholder={productName || 'Product name'}
            value={daraz.content}
            onChange={(e) => set('content', e.target.value)}
          />
        </Field>
      </section>

      {daraz.categoryId !== null && (attributesLoading || (attributes && attributes.length > 0)) && (
        <section className="daraz-section">
          <h3>
            <span className="step-num">4</span> Category details
          </h3>
          {attributesLoading && <p className="muted">Loading the fields this category needs…</p>}
          {visibleAttributes.length > 0 && <div className="daraz-grid">{visibleAttributes.map(renderAttribute)}</div>}
          {hasOptional && (
            <div>
              <button type="button" className="text-btn" onClick={() => setShowOptional((v) => !v)}>
                {showOptional ? 'Hide optional fields' : 'Show optional fields'}
              </button>
            </div>
          )}
        </section>
      )}
    </section>
  );
}
