import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import api from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { useOrderStats } from '../../hooks/useOrders';
import { useProducts } from '../../hooks/useProducts';

const STATUS_COLORS: Record<string, string> = {
  pending: '#f59e0b',
  confirmed: '#0f766e',
  shipped: '#2563eb',
  delivered: '#16a34a',
  cancelled: '#dc2626',
};

const STAT_ICON_PATHS: Record<string, ReactNode> = {
  products: (
    <>
      <path d="M21 8 12 3 3 8l9 5 9-5Z" />
      <path d="M3 8v8l9 5 9-5V8" />
      <line x1="12" y1="13" x2="12" y2="21" />
    </>
  ),
  orders: (
    <>
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </>
  ),
  revenue: (
    <>
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </>
  ),
  aov: (
    <>
      <line x1="6" y1="20" x2="6" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="18" y1="20" x2="18" y2="14" />
    </>
  ),
  week: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </>
  ),
  customers: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <line x1="19" y1="8" x2="19" y2="14" />
      <line x1="16" y1="11" x2="22" y2="11" />
    </>
  ),
  repeat: (
    <>
      <path d="M21 2v6h-6" />
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M3 22v-6h6" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
    </>
  ),
};

function StatIcon({ name }: { name: string }) {
  return (
    <span className="stat-icon">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {STAT_ICON_PATHS[name]}
      </svg>
    </span>
  );
}

const emptyStats = {
  totalOrders: 0,
  revenue: 0,
  aov: 0,
  paidOrders: 0,
  byDay: [] as Array<{ day: string; revenue: number; orders: number; newCustomers?: number }>,
  lowStock: [] as Array<{ _id: string; name: string; stock: number }>,
  statusCounts: {} as Record<string, number>,
  thisWeekRevenue: 0,
  lastWeekRevenue: 0,
  topSelling: [] as Array<{ productId: string; name: string; units: number; revenue: number }>,
  byCategory: [] as Array<{ category: string; revenue: number }>,
  newCustomers: 0,
  uniqueCustomers: 0,
  repeatCustomers: 0,
  repeatCustomerRate: 0,
  couponUsage: [] as Array<{ code: string; orders: number; discount: number }>,
};

export default function Dashboard() {
  const toast = useToast();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [applied, setApplied] = useState<{ from?: string; to?: string }>({});

  const { data: stats = emptyStats, isLoading: loading, isError } = useOrderStats(applied);
  const { data: productsData } = useProducts({ limit: 1 });
  const productCount = productsData?.total ?? productsData?.items?.length ?? 0;
  const error = isError ? 'Could not load dashboard stats.' : '';

  async function downloadReport() {
    try {
      const params: Record<string, string> = {};
      if (from) params.from = from;
      if (to) params.to = to;

      const { data } = await api.get('/orders/export', {
        params,
        responseType: 'blob',
      });
      const url = URL.createObjectURL(new Blob([data], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'orders-report.csv';
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Report downloaded');
    } catch {
      toast.error('Download failed');
    }
  }

  const weekDelta = stats.thisWeekRevenue - stats.lastWeekRevenue;
  const statusData = Object.entries(stats.statusCounts || {}).map(([name, value]) => ({
    name,
    value,
    fill: STATUS_COLORS[name] || '#64748b',
  }));
  const topProductsData = (stats.topSelling || []).map((row) => ({
    name: row.name.length > 18 ? `${row.name.slice(0, 16)}…` : row.name,
    units: row.units,
    revenue: row.revenue,
  }));
  const categoryData = (stats.byCategory || []).map((row) => ({
    name: row.category,
    revenue: Math.round(row.revenue * 100) / 100,
  }));

  return (
    <div>
      <h1>Dashboard</h1>
      <p className="muted">Quantum Logics Limited — QuantumStore overview.</p>
      {error && <p className="form-error">{error}</p>}

      <div className="dashboard-filters">
        <label>
          From
          <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          To
          <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setApplied({ from: from || undefined, to: to || undefined })}
        >
          Filter
        </button>
        <button type="button" className="btn btn-secondary" onClick={downloadReport}>
          Download report CSV
        </button>
      </div>

      {loading && <p className="muted">Loading stats…</p>}

      <div className="stat-grid">
        <div className="stat">
          <StatIcon name="products" />
          <div>
            <p className="stat-label">Products</p>
            <strong>{productCount}</strong>
          </div>
        </div>
        <div className="stat">
          <StatIcon name="orders" />
          <div>
            <p className="stat-label">Orders</p>
            <strong>{stats.totalOrders}</strong>
          </div>
        </div>
        <div className="stat">
          <StatIcon name="revenue" />
          <div>
            <p className="stat-label">Revenue</p>
            <strong>${stats.revenue.toFixed(2)}</strong>
          </div>
        </div>
        <div className="stat">
          <StatIcon name="aov" />
          <div>
            <p className="stat-label">AOV</p>
            <strong>${(stats.aov ?? 0).toFixed(2)}</strong>
          </div>
        </div>
        <div className="stat">
          <StatIcon name="week" />
          <div>
            <p className="stat-label">This week</p>
            <strong>${stats.thisWeekRevenue.toFixed(2)}</strong>
            <p className={weekDelta >= 0 ? 'muted' : 'danger-text'}>
              {weekDelta >= 0 ? '+' : ''}${weekDelta.toFixed(2)} vs last week
            </p>
          </div>
        </div>
        <div className="stat">
          <StatIcon name="customers" />
          <div>
            <p className="stat-label">New customers</p>
            <strong>{stats.newCustomers ?? 0}</strong>
          </div>
        </div>
        <div className="stat">
          <StatIcon name="repeat" />
          <div>
            <p className="stat-label">Repeat rate</p>
            <strong>{stats.repeatCustomerRate ?? 0}%</strong>
            <p className="muted">
              {stats.repeatCustomers ?? 0} of {stats.uniqueCustomers ?? 0} customers
            </p>
          </div>
        </div>
      </div>

      <div className="admin-panels">
        <section className="admin-form dashboard-panel">
          <h2>Revenue & orders</h2>
          {!stats.byDay.length && (
            <div className="dashboard-empty">
              <p className="muted">No sales data yet.</p>
            </div>
          )}
          {stats.byDay.length > 0 && (
            <div style={{ width: '100%', height: 260 }}>
              <ResponsiveContainer>
                <LineChart data={stats.byDay}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(5)} fontSize={12} />
                  <YAxis yAxisId="left" fontSize={12} />
                  <YAxis yAxisId="right" orientation="right" fontSize={12} allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Line yAxisId="left" type="monotone" dataKey="revenue" stroke="#0f766e" strokeWidth={2} name="Revenue" />
                  <Line yAxisId="right" type="monotone" dataKey="orders" stroke="#2563eb" strokeWidth={2} name="Orders" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        <section className="admin-form dashboard-panel">
          <h2>Order status</h2>
          {!statusData.length && (
            <div className="dashboard-empty">
              <p className="muted">No orders yet.</p>
            </div>
          )}
          {statusData.length > 0 && (
            <div style={{ width: '100%', height: 260 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={2}>
                    {statusData.map((entry) => (
                      <Cell key={entry.name} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
      </div>

      <div className="admin-panels">
        <section className="admin-form dashboard-panel">
          <h2>Top selling</h2>
          {!topProductsData.length && (
            <div className="dashboard-empty">
              <p className="muted">No sales yet.</p>
            </div>
          )}
          {topProductsData.length > 0 && (
            <div style={{ width: '100%', height: 260 }}>
              <ResponsiveContainer>
                <BarChart data={topProductsData} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis type="number" fontSize={12} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" width={110} fontSize={11} />
                  <Tooltip />
                  <Bar dataKey="units" fill="#0f766e" name="Units sold" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        <section className="admin-form dashboard-panel">
          <h2>Revenue by category</h2>
          {!categoryData.length && (
            <div className="dashboard-empty">
              <p className="muted">No category data.</p>
            </div>
          )}
          {categoryData.length > 0 && (
            <div style={{ width: '100%', height: 260 }}>
              <ResponsiveContainer>
                <BarChart data={categoryData}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="name" fontSize={11} />
                  <YAxis fontSize={12} />
                  <Tooltip />
                  <Bar dataKey="revenue" fill="#2563eb" name="Revenue" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
      </div>

      <div className="admin-panels">
        <section className="admin-form dashboard-panel">
          <h2>Coupon usage</h2>
          {!stats.couponUsage?.length && <p className="muted">No coupons used in this range.</p>}
          <ul className="low-stock-list">
            {stats.couponUsage?.map((row) => (
              <li key={row.code}>
                <span>
                  {row.code} · {row.orders} orders
                </span>
                <strong>-${row.discount.toFixed(2)}</strong>
              </li>
            ))}
          </ul>
        </section>

        <section className="admin-form dashboard-panel">
          <h2>Low stock alerts</h2>
          {!stats.lowStock?.length && <p className="muted">All products above threshold.</p>}
          <ul className="low-stock-list">
            {stats.lowStock?.map((product) => (
              <li key={product._id}>
                <span>{product.name}</span>
                <strong className={product.stock <= 3 ? 'danger-text' : ''}>{product.stock} left</strong>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="admin-quick">
        <Link to="/products" className="btn btn-primary">
          Manage products
        </Link>
        <Link to="/orders" className="btn btn-secondary">
          View orders
        </Link>
        <Link to="/settings" className="btn btn-ghost">
          Settings
        </Link>
      </div>
    </div>
  );
}
