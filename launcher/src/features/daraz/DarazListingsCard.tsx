import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getAllDarazListings, removeFromDaraz } from '../../api/daraz';
import { useConfirm } from '../../context/ConfirmContext';
import { useToast } from '../../context/ToastContext';
import { getErrorMessage } from '../../utils/errors';

/**
 * Everything the Launcher has listed on Daraz. Deleting a product here removes its Daraz listing too; this list is
 * for leftovers, such as a product that was deleted before that was automatic.
 */
export default function DarazListingsCard() {
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [removing, setRemoving] = useState('');
  const [error, setError] = useState('');

  // Optional like the other Daraz lookups: if Daraz is not set up the card simply stays hidden.
  const { data: rows } = useQuery({ queryKey: ['daraz', 'listings', 'all'], queryFn: getAllDarazListings, retry: false });
  if (!rows?.length) return null;

  async function remove(itemId: string) {
    const ok = await confirm('This takes the item off Daraz.', {
      title: 'Remove from Daraz?',
      confirmLabel: 'Remove',
      tone: 'danger',
    });
    if (!ok) return;
    setRemoving(itemId);
    setError('');
    try {
      await removeFromDaraz({ itemId });
      await queryClient.invalidateQueries({ queryKey: ['daraz', 'listings'] });
      toast.success('Removed from Daraz');
    } catch (err) {
      setError(`Daraz did not remove item ${itemId}: ${getErrorMessage(err, 'Daraz refused the request')}`);
    } finally {
      setRemoving('');
    }
  }

  return (
    <details className="daraz-details" style={{ marginTop: '1.5rem' }}>
      <summary>
        <strong>Listed on Daraz</strong> <span className="muted">· {rows.length}</span>
      </summary>
      <div style={{ padding: 'var(--space-4)', display: 'grid', gap: 'var(--space-3)' }}>
        {error && <p className="form-error" style={{ margin: 0 }}>{error}</p>}
        {rows.map((row) => (
          <div key={row.itemId} className="admin-quick" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <span>
              Item {row.itemId} <span className="muted">· {row.sellerSku}</span>
            </span>
            <button type="button" className="btn btn-ghost" disabled={removing === row.itemId} onClick={() => remove(row.itemId)}>
              {removing === row.itemId ? 'Removing…' : 'Remove from Daraz'}
            </button>
          </div>
        ))}
      </div>
    </details>
  );
}
