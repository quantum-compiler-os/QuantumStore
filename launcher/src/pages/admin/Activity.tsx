import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import api from '../../api/client';
import type { ActivityLog } from '../../api/types';
import { useToast } from '../../context/ToastContext';
import { getErrorMessage } from '../../utils/errors';

const DAY_RANGES = [7, 30, 90, 180] as const;
type DayRange = (typeof DAY_RANGES)[number];

type ActivityStatsPoint = { day: string; count: number };

export default function Activity() {
  const toast = useToast();
  const [items, setItems] = useState<ActivityLog[]>([]);
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');
  const [targetType, setTargetType] = useState('');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);

  const [chartType, setChartType] = useState<'line' | 'bar'>('line');
  const [days, setDays] = useState<DayRange>(30);
  const [chartData, setChartData] = useState<ActivityStatsPoint[]>([]);
  const [chartLoading, setChartLoading] = useState(true);

  async function load(nextPage = page) {
    setLoading(true);
    try {
      const { data } = await api.get('/activity', {
        params: {
          page: nextPage,
          limit: 30,
          search: search || undefined,
          action: action || undefined,
          targetType: targetType || undefined,
        },
      });
      setItems(data.items);
      setPages(data.pages);
      setPage(data.page);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not load activity'));
    } finally {
      setLoading(false);
    }
  }

  async function loadStats(nextDays: DayRange) {
    setChartLoading(true);
    try {
      const { data } = await api.get('/activity/stats', { params: { days: nextDays } });
      setChartData(data.byDay || []);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not load activity chart'));
    } finally {
      setChartLoading(false);
    }
  }

  useEffect(() => {
    load(1);
  }, []);

  useEffect(() => {
    loadStats(days);
  }, [days]);

  return (
    <div>
      <h1>Activity log</h1>
      <p className="muted">Audit trail for products, orders, stock, and staff changes.</p>

      <section className="admin-form" style={{ marginBottom: '1rem' }}>
        <div className="activity-chart-head">
          <h2>Activity volume</h2>
          <div className="activity-chart-controls">
            <div className="segmented">
              <button
                type="button"
                className={`segmented-option ${chartType === 'line' ? 'active' : ''}`}
                onClick={() => setChartType('line')}
              >
                Line
              </button>
              <button
                type="button"
                className={`segmented-option ${chartType === 'bar' ? 'active' : ''}`}
                onClick={() => setChartType('bar')}
              >
                Bars
              </button>
            </div>
            <div className="category-row">
              {DAY_RANGES.map((range) => (
                <button
                  key={range}
                  type="button"
                  className={`chip ${days === range ? 'active' : ''}`}
                  onClick={() => setDays(range)}
                >
                  {range}D
                </button>
              ))}
            </div>
          </div>
        </div>

        {chartLoading && chartData.length === 0 && <p className="muted">Loading chart…</p>}
        {chartData.length > 0 && (
          <div
            style={{
              width: '100%',
              height: 240,
              opacity: chartLoading ? 0.55 : 1,
              transition: 'opacity 150ms ease',
            }}
          >
            <ResponsiveContainer>
              {chartType === 'line' ? (
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(5)} fontSize={12} />
                  <YAxis fontSize={12} allowDecimals={false} />
                  <Tooltip />
                  <Line type="monotone" dataKey="count" stroke="#0f766e" strokeWidth={2} name="Events" dot={false} isAnimationActive={false} />
                </LineChart>
              ) : (
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(5)} fontSize={12} />
                  <YAxis fontSize={12} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#0f766e" name="Events" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        )}
        {!chartLoading && chartData.length > 0 && !chartData.some((point) => point.count > 0) && (
          <p className="muted" style={{ marginTop: '0.5rem' }}>No activity in this range.</p>
        )}
      </section>

      <form
        className="admin-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          load(1);
        }}
      >
        <div className="admin-search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            className="input"
            placeholder="Search actor, action, target…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <input
          className="input admin-toolbar-action"
          placeholder="Action filter"
          value={action}
          onChange={(e) => setAction(e.target.value)}
        />
        <select className="input admin-toolbar-select" value={targetType} onChange={(e) => setTargetType(e.target.value)}>
          <option value="">All targets</option>
          <option value="Product">Product</option>
          <option value="Order">Order</option>
          <option value="User">User</option>
          <option value="Coupon">Coupon</option>
        </select>
        <button type="submit" className="btn btn-secondary">
          Filter
        </button>
      </form>

      {loading && <p className="muted">Loading…</p>}
      <div className="table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Target</th>
              <th>Meta</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row._id}>
                <td data-label="When">{row.createdAt ? new Date(row.createdAt).toLocaleString() : '—'}</td>
                <td data-label="Actor">{row.actorEmail}</td>
                <td data-label="Action">{row.action}</td>
                <td data-label="Target">
                  {row.targetType} {row.targetId ? `#${String(row.targetId).slice(-6)}` : ''}
                </td>
                <td data-label="Meta">
                  <code className="muted">{JSON.stringify(row.meta || {})}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {page < pages && (
        <button type="button" className="btn btn-secondary" onClick={() => load(page + 1)}>
          Load more
        </button>
      )}
    </div>
  );
}
