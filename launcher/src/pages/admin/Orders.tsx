import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import api from '../../api/client';
import type { Order } from '../../api/types';
import { useToast } from '../../context/ToastContext';
import { useAdminOrders } from '../../hooks/useOrders';
import { queryKeys } from '../../hooks/queryKeys';
import { getErrorMessage } from '../../utils/errors';

const statuses = ['all', 'pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];

function orderTotal(order: Order) {
  return Number(order.totalAmount ?? order.total ?? 0);
}

export default function Orders() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Order | null>(null);
  const [returnBusy, setReturnBusy] = useState(false);

  const params = { status, search: appliedSearch, page, limit: 10 };
  const { data, isLoading: loading, isError, refetch } = useAdminOrders(params);
  const orders = data?.items || [];
  const pages = data?.pages || 1;
  const error = isError ? 'Failed to load orders' : '';

  useEffect(() => {
    if (!selected) return;
    const refreshed = orders.find((order) => order._id === selected._id);
    if (refreshed) setSelected(refreshed);
  }, [orders, selected]);

  async function updateStatus(id: string, nextStatus: string) {
    try {
      await api.patch(`/orders/${id}/status`, { status: nextStatus });
      await queryClient.invalidateQueries({ queryKey: queryKeys.orders.all });
      toast.success('Order updated');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not update order'));
    }
  }

  async function handleReturnAction(action: string) {
    if (!selected) return;
    setReturnBusy(true);
    try {
      const { data: updated } = await api.patch<Order>(`/orders/${selected._id}/return`, { action });
      setSelected(updated);
      await refetch();
      toast.success(`Return ${action}`);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Return action failed'));
    } finally {
      setReturnBusy(false);
    }
  }

  async function exportCsv() {
    try {
      const { data: blob } = await api.get('/orders/export', {
        params: { status },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(new Blob([blob], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'orders.csv';
      a.click();
      URL.revokeObjectURL(url);
      toast.success('CSV exported');
    } catch {
      toast.error('Export failed');
    }
  }

  const returnActive =
    selected && (selected.returnStatus === 'requested' || selected.returnStatus === 'approved');

  return (
    <div>
      <h1>Orders</h1>
      <p className="muted">Track purchases and update fulfillment status.</p>
      {error && <p className="form-error">{error}</p>}

      <div className="shop-top-row" style={{ marginBottom: '1rem' }}>
        <input
          className="input"
          placeholder="Search customer/email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            setPage(1);
            setAppliedSearch(search);
          }}
        >
          Search
        </button>
        <button type="button" className="btn btn-secondary" onClick={exportCsv}>
          Export CSV
        </button>
      </div>

      <div className="category-row" style={{ marginBottom: '1rem' }}>
        {statuses.map((item) => (
          <button
            key={item}
            type="button"
            className={`chip ${status === item ? 'active' : ''}`}
            onClick={() => {
              setStatus(item);
              setPage(1);
            }}
          >
            {item}
          </button>
        ))}
      </div>

      {loading && <p className="muted">Loading orders…</p>}

      <div className="orders-split">
        <div className="order-list">
          {orders.map((order) => (
            <article key={order._id} className={`order-card ${selected?._id === order._id ? 'selected' : ''}`}>
              <button type="button" className="order-select" onClick={() => setSelected(order)}>
                <div className="order-head">
                  <div>
                    <h3>{order.customerName}</h3>
                    <p className="muted">
                      {order.email} · {order.status} · {order.paymentStatus}
                      {order.returnStatus && order.returnStatus !== 'none' ? ` · Return: ${order.returnStatus}` : ''}
                    </p>
                  </div>
                  <strong>${orderTotal(order).toFixed(2)}</strong>
                </div>
              </button>
              <label>
                Status
                <select
                  className="input"
                  value={order.status}
                  onChange={(e) => updateStatus(order._id, e.target.value)}
                >
                  {statuses
                    .filter((s) => s !== 'all')
                    .map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                </select>
              </label>
            </article>
          ))}
        </div>

        <aside className="order-card order-detail">
          {!selected && <p className="muted">Select an order to view details.</p>}
          {selected && (
            <>
              <h2>Order detail</h2>
              <p>
                <strong>{selected.customerName}</strong>
              </p>
              <p className="muted">
                {selected.email} · {selected.phone}
              </p>
              <p>{selected.address}</p>
              <p className="muted">
                Payment: {selected.paymentMethod} / {selected.paymentStatus}
                {selected.couponCode ? ` · Coupon ${selected.couponCode}` : ''}
              </p>
              <p className="muted">
                Shipping: {selected.shippingMethod || 'standard'}
                {selected.shippingFee != null ? ` — $${Number(selected.shippingFee).toFixed(2)}` : ''}
              </p>
              {selected.note ? <p className="muted">Note: {selected.note}</p> : null}
              {selected.returnStatus && selected.returnStatus !== 'none' && (
                <p className="muted">
                  Return: <strong>{selected.returnStatus}</strong>
                  {selected.returnReason ? ` — ${selected.returnReason}` : ''}
                </p>
              )}
              <ul>
                {selected.items.map((item, index) => (
                  <li key={`${selected._id}-${index}`}>
                    {item.name} × {item.quantity} — ${(item.price * item.quantity).toFixed(2)}
                  </li>
                ))}
              </ul>
              <p className="price">Total ${orderTotal(selected).toFixed(2)}</p>
              {returnActive && (
                <div className="admin-quick" style={{ marginTop: '1rem' }}>
                  {selected.returnStatus === 'requested' && (
                    <>
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={returnBusy}
                        onClick={() => handleReturnAction('approved')}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={returnBusy}
                        onClick={() => handleReturnAction('rejected')}
                      >
                        Reject
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={returnBusy}
                    onClick={() => handleReturnAction('refunded')}
                  >
                    Mark refunded
                  </button>
                </div>
              )}
            </>
          )}
        </aside>
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

      {!loading && !orders.length && !error && <p className="muted">No orders yet.</p>}
    </div>
  );
}
