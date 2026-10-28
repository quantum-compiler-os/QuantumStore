import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/** Launcher is staff-only. The backend still enforces the owner check on every call. */
export default function ProtectedRoute() {
  const { user, loading, isStaff } = useAuth();

  if (loading) {
    return (
      <div className="admin-loading">
        <p>Loading…</p>
      </div>
    );
  }
  if (!user || !isStaff) return <Navigate to="/login" replace />;
  return <Outlet />;
}
