import { Suspense, lazy } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import { AuthProvider } from './context/AuthContext';
import { ConfirmProvider } from './context/ConfirmContext';
import { ThemeProvider } from './context/ThemeContext';
import { ToastProvider } from './context/ToastContext';

const Login = lazy(() => import('./pages/Login'));
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'));
const Dashboard = lazy(() => import('./pages/admin/Dashboard'));
const Publish = lazy(() => import('./pages/admin/Publish'));
const Products = lazy(() => import('./pages/admin/Products'));
const Audionic = lazy(() => import('./pages/admin/Audionic'));
const Sync = lazy(() => import('./pages/admin/Sync'));
const Categories = lazy(() => import('./features/admin/CategoriesAdmin'));
const Orders = lazy(() => import('./pages/admin/Orders'));
const Coupons = lazy(() => import('./pages/admin/Coupons'));
const Customers = lazy(() => import('./pages/admin/Customers'));
const Settings = lazy(() => import('./pages/admin/Settings'));
const Activity = lazy(() => import('./pages/admin/Activity'));
const Questions = lazy(() => import('./pages/admin/Questions'));
const GiftCards = lazy(() => import('./pages/admin/GiftCards'));
const Bundles = lazy(() => import('./pages/admin/Bundles'));

function PageFallback() {
  return (
    <div className="admin-loading">
      <p>Loading…</p>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <ConfirmProvider>
          <AuthProvider>
            <BrowserRouter>
              <Suspense fallback={<PageFallback />}>
                <Routes>
                  <Route path="/login" element={<Login />} />
                  <Route element={<ProtectedRoute />}>
                    <Route element={<AdminLayout />}>
                      <Route index element={<Dashboard />} />
                      <Route path="publish" element={<Publish />} />
                      <Route path="products" element={<Products />} />
                      <Route path="audionic" element={<Audionic />} />
                      <Route path="sync" element={<Sync />} />
                      <Route path="categories" element={<Categories />} />
                      <Route path="orders" element={<Orders />} />
                      <Route path="questions" element={<Questions />} />
                      <Route path="coupons" element={<Coupons />} />
                      <Route path="gift-cards" element={<GiftCards />} />
                      <Route path="bundles" element={<Bundles />} />
                      <Route path="customers" element={<Customers />} />
                      <Route path="activity" element={<Activity />} />
                      <Route path="settings" element={<Settings />} />
                    </Route>
                  </Route>
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Suspense>
            </BrowserRouter>
          </AuthProvider>
        </ConfirmProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
