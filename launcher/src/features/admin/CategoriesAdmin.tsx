import { useEffect, useState, type FormEvent } from 'react';
import type { AxiosError } from 'axios';
import { Button, FormField, Input, DataTable } from '../../ui';
import type { Category } from '../../api/types';
import { useConfirm } from '../../context/ConfirmContext';
import { useCategories, useCreateCategory, useDeleteCategory } from '../../hooks/useCategories';

export default function CategoriesAdmin() {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const confirm = useConfirm();

  const { data: categories = [], isError } = useCategories();
  const createMut = useCreateCategory();
  const deleteMut = useDeleteCategory();

  useEffect(() => {
    if (isError) setError('Failed to load categories');
  }, [isError]);

  return (
    <div>
      <h1>Categories</h1>
      <p className="muted">Manage product categories used across the store.</p>

      <form
        className="admin-form"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          createMut.mutate(name, {
            onSuccess: () => {
              setName('');
              setError('');
            },
            onError: (err) => {
              const axiosErr = err as AxiosError<{ message?: string }>;
              setError(axiosErr.response?.data?.message || 'Could not add category');
            },
          });
        }}
      >
        <FormField label="New category" error={error}>
          <Input required minLength={2} value={name} onChange={(e) => setName(e.target.value)} />
        </FormField>
        <Button type="submit" disabled={createMut.isPending}>
          {createMut.isPending ? 'Adding…' : 'Add category'}
        </Button>
      </form>

      <DataTable<Category>
        columns={[
          { key: 'name', header: 'Name', render: (row) => row.name },
          {
            key: 'actions',
            header: '',
            render: (row) => (
              <button
                type="button"
                className="text-btn danger"
                onClick={async () => {
                  const ok = await confirm('Products in this category will be unaffected.', {
                    title: 'Delete this category?',
                    confirmLabel: 'Delete',
                    tone: 'danger',
                  });
                  if (ok) {
                    deleteMut.mutate(row._id, {
                      onError: (err) => {
                        const axiosErr = err as AxiosError<{ message?: string }>;
                        setError(axiosErr.response?.data?.message || 'Could not delete category');
                      },
                    });
                  }
                }}
              >
                Delete
              </button>
            ),
          },
        ]}
        rows={categories}
        rowKey={(row) => row._id}
        emptyMessage="No categories yet."
      />
    </div>
  );
}
