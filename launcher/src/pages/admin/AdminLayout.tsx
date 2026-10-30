import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import BrandLogo from '../../components/BrandLogo';
import { useAuth } from '../../context/AuthContext';

const ICON_PATHS: Record<string, ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="3" width="7" height="7.5" rx="1.5" />
      <rect x="3" y="13" width="7.5" height="8" rx="1.5" />
      <rect x="13.5" y="13" width="7" height="8" rx="1.5" />
    </>
  ),
  products: (
    <>
      <path d="M21 8 12 3 3 8l9 5 9-5Z" />
      <path d="M3 8v8l9 5 9-5V8" />
      <line x1="12" y1="13" x2="12" y2="21" />
    </>
  ),
  publish: (
    <>
      <path d="M4 14.5 14.5 4l5.5 5.5L9.5 20 4 20Z" />
      <path d="M14.5 4 20 9.5" />
      <path d="m12 12 5-5" />
    </>
  ),
  audionic: (
    <>
      <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
      <rect x="2.5" y="14" width="4" height="6" rx="1.5" />
      <rect x="17.5" y="14" width="4" height="6" rx="1.5" />
    </>
  ),
  categories: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />,
  orders: (
    <>
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </>
  ),
  qa: (
    <path d="M21 11.5a8.48 8.48 0 0 1-8.5 8.5 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8A8.48 8.48 0 0 1 12.5 3a8.5 8.5 0 0 1 8.5 8.5Z" />
  ),
  coupons: (
    <>
      <line x1="19" y1="5" x2="5" y2="19" />
      <circle cx="6.5" cy="6.5" r="2.5" />
      <circle cx="17.5" cy="17.5" r="2.5" />
    </>
  ),
  gift: (
    <>
      <rect x="3" y="8" width="18" height="4" rx="1" />
      <path d="M19 12v7a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-7" />
      <path d="M12 8v13" />
      <path d="M7.5 8a2.5 2.5 0 1 1 0-5C10 3 12 8 12 8" />
      <path d="M16.5 8a2.5 2.5 0 1 0 0-5C14 3 12 8 12 8" />
    </>
  ),
  bundles: (
    <>
      <path d="M12 2 2 7l10 5 10-5-10-5Z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </>
  ),
  customers: (
    <>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  activity: <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </>
  ),
  store: (
    <>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </>
  ),
  logout: (
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </>
  ),
};

const STORE_URL = import.meta.env.VITE_STORE_URL || 'http://127.0.0.1:5173';

function NavIcon({ name }: { name: string }) {
  return (
    <svg
      className="admin-nav-icon"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

type NavItem = {
  to: string;
  label: string;
  icon: string;
  end?: boolean;
  badge?: number;
};

export default function AdminLayout() {
  const { user, logout, isAdmin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [qaCount, setQaCount] = useState(0);

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    document.body.classList.toggle('admin-drawer-open', drawerOpen);
    return () => document.body.classList.remove('admin-drawer-open');
  }, [drawerOpen]);

  useEffect(() => {
    import('../../api/client').then(({ default: api }) => {
      api
        .get('/questions/unanswered/count')
        .then((res: { data: { count?: number } }) => setQaCount(res.data.count || 0))
        .catch(() => {});
    });
  }, [location.pathname]);

  function handleLogout() {
    logout();
    navigate('/login');
  }

  const navItems: NavItem[] = [
    { to: '/', label: 'Dashboard', icon: 'dashboard', end: true },
    { to: '/publish', label: 'Publish', icon: 'publish' },
    { to: '/products', label: 'Products', icon: 'products' },
    { to: '/audionic', label: 'Audionic', icon: 'audionic' },
    { to: '/categories', label: 'Categories', icon: 'categories' },
    { to: '/orders', label: 'Orders', icon: 'orders' },
    { to: '/questions', label: 'Q&A', icon: 'qa', badge: qaCount },
    ...(isAdmin ? [{ to: '/coupons', label: 'Coupons', icon: 'coupons' }] : []),
    ...(isAdmin ? [{ to: '/gift-cards', label: 'Gift cards', icon: 'gift' }] : []),
    { to: '/bundles', label: 'Bundles', icon: 'bundles' },
    ...(isAdmin ? [{ to: '/customers', label: 'Customers', icon: 'customers' }] : []),
    ...(isAdmin ? [{ to: '/activity', label: 'Activity', icon: 'activity' }] : []),
    ...(isAdmin ? [{ to: '/settings', label: 'Settings', icon: 'settings' }] : []),
  ];

  const nav = (
    <>
      {navItems.map((item) => (
        <NavLink key={item.to} to={item.to} end={item.end} onClick={() => setDrawerOpen(false)}>
          <NavIcon name={item.icon} />
          <span>{item.label}</span>
          {!!item.badge && <span className="admin-nav-badge">{item.badge}</span>}
        </NavLink>
      ))}
    </>
  );

  return (
    <div className={`admin-shell ${drawerOpen ? 'drawer-open' : ''}`}>
      <header className="admin-topbar">
        <button
          type="button"
          className="nav-burger admin-burger"
          aria-expanded={drawerOpen}
          aria-controls="admin-nav"
          aria-label={drawerOpen ? 'Close menu' : 'Open menu'}
          onClick={() => setDrawerOpen((v) => !v)}
        >
          <span />
          <span />
          <span />
        </button>
        <p className="footer-brand">
          <BrandLogo size={26} withText textClassName="footer-brand-text" />
        </p>
        <span className="muted admin-user-chip">{user?.role}</span>
      </header>

      {drawerOpen && (
        <button type="button" className="admin-scrim" aria-label="Close admin menu" onClick={() => setDrawerOpen(false)} />
      )}

      <aside id="admin-nav" className={`admin-sidebar ${drawerOpen ? 'open' : ''}`}>
        <p className="footer-brand admin-sidebar-brand">
          <BrandLogo size={28} withText textClassName="footer-brand-text" />
        </p>
        <div className="admin-user-card">
          <span className="admin-avatar" aria-hidden="true">
            {(user?.email || '?').charAt(0).toUpperCase()}
          </span>
          <div className="admin-user-info">
            <p className="admin-user-name">Quantum Logics Limited</p>
            <p className="admin-user-email" title={user?.email}>
              {user?.email}
            </p>
          </div>
          {user?.role && <span className="admin-role-badge">{user.role}</span>}
        </div>
        <nav>{nav}</nav>
        <div className="admin-sidebar-footer">
          <a href={STORE_URL} target="_blank" rel="noreferrer">
            <NavIcon name="store" />
            <span>View store</span>
          </a>
          <button type="button" className="btn btn-ghost" onClick={handleLogout}>
            <NavIcon name="logout" />
            <span>Log out</span>
          </button>
        </div>
      </aside>
      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  );
}
