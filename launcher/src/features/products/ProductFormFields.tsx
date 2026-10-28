import { useRef, useState, type ChangeEvent, type Dispatch, type DragEvent, type SetStateAction } from 'react';
import api from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { useCreateCategory } from '../../hooks/useCategories';
import { getErrorMessage } from '../../utils/errors';
import type { ProductForm } from './productForm';

const NEW_CATEGORY_VALUE = '__new_category__';

type Props = {
  form: ProductForm;
  setForm: Dispatch<SetStateAction<ProductForm>>;
  categories: string[];
  /** Hide the store category when something else (the Daraz category) decides it. */
  hideCategory?: boolean;
  onError: (message: string) => void;
  onUploadingChange?: (uploading: boolean) => void;
};

/** The product fields shared by "Publish" and "Edit": details, Cloudinary image upload, variants, specs. */
export default function ProductFormFields({
  form,
  setForm,
  categories,
  hideCategory = false,
  onError,
  onUploadingChange,
}: Props) {
  const toast = useToast();
  const createCategoryMut = useCreateCategory();
  const [uploading, setUploading] = useState(false);
  const [imageUrlInput, setImageUrlInput] = useState('');
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [categoryError, setCategoryError] = useState('');
  const dragIndexRef = useRef<number | null>(null);

  function setBusy(value: boolean) {
    setUploading(value);
    onUploadingChange?.(value);
  }

  async function handleAddCategory() {
    const name = newCategoryName.trim();
    if (name.length < 2) {
      setCategoryError('Category name must be at least 2 characters');
      return;
    }
    try {
      const created = await createCategoryMut.mutateAsync(name);
      setForm((prev) => ({ ...prev, category: created?.name || name }));
      setNewCategoryName('');
      setAddingCategory(false);
      setCategoryError('');
      toast.success('Category added');
    } catch (err) {
      setCategoryError(getErrorMessage(err, 'Could not add category'));
    }
  }

  async function handleUpload(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setBusy(true);
    try {
      // Goes through the backend's POST /api/uploads, which stores on Cloudinary.
      const uploaded = await Promise.all(
        files.map(async (file) => {
          const body = new FormData();
          body.append('image', file);
          const { data } = await api.post<{ url: string; thumbnail?: string }>('/uploads', body, {
            headers: { 'Content-Type': 'multipart/form-data' },
          });
          return { url: data.url, thumbnail: data.thumbnail || data.url };
        }),
      );
      setForm((prev) => ({ ...prev, images: [...prev.images, ...uploaded] }));
      toast.success(uploaded.length > 1 ? `${uploaded.length} images uploaded` : 'Image uploaded');
    } catch (err) {
      onError(getErrorMessage(err, 'Image upload failed'));
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  }

  function addImageUrl() {
    const url = imageUrlInput.trim();
    if (!url) return;
    setForm((prev) => ({ ...prev, images: [...prev.images, { url, thumbnail: url }] }));
    setImageUrlInput('');
  }

  function removeImage(index: number) {
    setForm((prev) => ({ ...prev, images: prev.images.filter((_, i) => i !== index) }));
  }

  function makeCoverImage(index: number) {
    setForm((prev) => {
      if (index === 0) return prev;
      const next = [...prev.images];
      const [moved] = next.splice(index, 1);
      next.unshift(moved);
      return { ...prev, images: next };
    });
  }

  function handleImageDrop(index: number) {
    const from = dragIndexRef.current;
    dragIndexRef.current = null;
    if (from === null || from === index) return;
    setForm((prev) => {
      const next = [...prev.images];
      const [moved] = next.splice(from, 1);
      next.splice(index, 0, moved);
      return { ...prev, images: next };
    });
  }

  return (
    <>
      <div className="form-grid">
        <label>
          Name
          <input
            className="input"
            required
            minLength={2}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </label>
        <label>
          Brand
          <input className="input" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} />
        </label>
        <label>
          Price (Rs)
          <input
            className="input"
            type="number"
            min="0"
            step="0.01"
            required
            value={form.price}
            onChange={(e) => setForm({ ...form, price: e.target.value })}
          />
        </label>
        <label>
          Stock
          <input
            className="input"
            type="number"
            min="0"
            placeholder="N/A (always in stock)"
            value={form.stock}
            onChange={(e) => setForm({ ...form, stock: e.target.value })}
          />
        </label>
        {!hideCategory && (
          <label>
            Category
            <select
              className="input"
              value={form.category}
              onChange={(e) => {
                if (e.target.value === NEW_CATEGORY_VALUE) {
                  setAddingCategory(true);
                  setCategoryError('');
                  return;
                }
                setForm({ ...form, category: e.target.value });
              }}
            >
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
              <option value={NEW_CATEGORY_VALUE}>+ Add new category…</option>
            </select>
          </label>
        )}
        <label>
          Product type
          <select
            className="input"
            value={form.productType}
            onChange={(e) => setForm({ ...form, productType: e.target.value as 'standard' | 'gift_card' })}
          >
            <option value="standard">Standard</option>
            <option value="gift_card">Gift card</option>
          </select>
        </label>
        <label>
          Upload images
          <div className="file-drop">
            <input
              className="file-drop-input"
              type="file"
              accept="image/*"
              multiple
              onChange={handleUpload}
              aria-label="Upload product images"
            />
            <span className="file-drop-button">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 16V4" />
                <path d="M6 10l6-6 6 6" />
                <path d="M4 20h16" />
              </svg>
              Choose files
            </span>
            {uploading && <span className="file-drop-name">Uploading…</span>}
          </div>
        </label>
      </div>

      {addingCategory && (
        <div className="admin-quick" style={{ alignItems: 'flex-start' }}>
          <label style={{ flex: 1 }}>
            New category name
            <input
              className="input"
              autoFocus
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddCategory();
                }
              }}
            />
          </label>
          <button type="button" className="btn btn-primary" disabled={createCategoryMut.isPending} onClick={handleAddCategory}>
            {createCategoryMut.isPending ? 'Adding…' : 'Add category'}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setAddingCategory(false);
              setNewCategoryName('');
              setCategoryError('');
            }}
          >
            Cancel
          </button>
        </div>
      )}
      {categoryError && <p className="form-error">{categoryError}</p>}

      <div className="admin-quick" style={{ marginTop: '0.5rem' }}>
        <input
          className="input"
          placeholder="Or paste an image URL…"
          value={imageUrlInput}
          onChange={(e) => setImageUrlInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addImageUrl();
            }
          }}
        />
        <button type="button" className="btn btn-ghost" onClick={addImageUrl}>
          Add URL
        </button>
      </div>

      {form.images.length > 0 && (
        <div className="image-gallery">
          {form.images.map((img, index) => (
            <div
              key={`${img.url}-${index}`}
              className={`image-gallery-item ${index === 0 ? 'is-cover' : ''}`}
              draggable
              onDragStart={() => {
                dragIndexRef.current = index;
              }}
              onDragOver={(e: DragEvent<HTMLDivElement>) => e.preventDefault()}
              onDrop={() => handleImageDrop(index)}
              title="Drag to reorder"
            >
              <img src={img.thumbnail || img.url} alt={`Product image ${index + 1}`} />
              {index === 0 ? (
                <span className="image-gallery-badge">Cover</span>
              ) : (
                <button type="button" className="image-gallery-cover-btn" onClick={() => makeCoverImage(index)}>
                  Set as cover
                </button>
              )}
              <button
                type="button"
                className="image-gallery-remove"
                onClick={() => removeImage(index)}
                aria-label={`Remove image ${index + 1}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <label>
        Variants (label,price,stock — one per line; blank stock = unlimited)
        <textarea
          className="input"
          rows={3}
          placeholder="256GB,899,10&#10;512GB,1099,5"
          value={form.variantsText}
          onChange={(e) => setForm({ ...form, variantsText: e.target.value })}
        />
      </label>
      <label>
        Specs (key:value — one per line)
        <textarea
          className="input"
          rows={3}
          placeholder="RAM:16GB&#10;Storage:512GB SSD"
          value={form.specsText}
          onChange={(e) => setForm({ ...form, specsText: e.target.value })}
        />
      </label>
      <label>
        Description
        <textarea
          className="input"
          rows={3}
          required
          minLength={10}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
      </label>
      <label className="checkbox-row">
        <input type="checkbox" checked={form.featured} onChange={(e) => setForm({ ...form, featured: e.target.checked })} />
        Featured on homepage
      </label>
    </>
  );
}
