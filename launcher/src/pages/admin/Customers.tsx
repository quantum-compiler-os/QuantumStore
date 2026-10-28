import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import api from '../../api/client';
import type { User } from '../../api/types';

type CustomerRow = User & { totalSpend?: number };
import { useAuth } from '../../context/AuthContext';

export default function Customers() {
  const { isAdmin } = useAuth();
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');

  async function load(nextSearch = search) {
    const { data } = await api.get('/users', { params: { search: nextSearch || undefined } });
    setCustomers(data);
  }

  useEffect(() => {
    if (!isAdmin) return;
    load('').catch(() => setError('Failed to load customers'));
  }, [isAdmin]);

  if (!isAdmin) return <Navigate to="/" replace />;

  return (
    <div>
      <h1>Customers</h1>
      <p className="muted">Registered shoppers and spend totals.</p>
      {error && <p className="form-error">{error}</p>}

      <div className="shop-top-row" style={{ marginBottom: '1rem' }}>
        <input className="input" placeholder="Search customers…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <button type="button" className="btn btn-ghost" onClick={() => load(search)}>
          Search
        </button>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Orders</th>
              <th>Spend</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((customer) => (
              <tr key={customer._id}>
                <td data-label="Name">{customer.name}</td>
                <td data-label="Email">{customer.email}</td>
                <td data-label="Orders">{customer.orderCount}</td>
                <td data-label="Spend">${Number(customer.totalSpend ?? 0).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!customers.length && <p className="muted">No customers yet.</p>}
    </div>
  );
}
