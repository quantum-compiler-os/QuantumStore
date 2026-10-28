import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import AuthAlert from '../components/AuthAlert';
import BrandLogo from '../components/BrandLogo';
import PasswordInput from '../components/PasswordInput';
import { useAuth } from '../context/AuthContext';
import { getErrorMessage } from '../utils/errors';

export default function Login() {
  const { login, logout, user, loading, isStaff } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!loading && user && isStaff) return <Navigate to="/" replace />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const loggedIn = await login(email, password);
      if (loggedIn.role === 'customer') {
        logout();
        setError('This account does not have access to the Launcher.');
      }
    } catch (err) {
      setError(getErrorMessage(err, 'Login failed. Check your email and password.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="section">
      <div className="container auth-card">
        <p className="footer-brand" style={{ marginBottom: '1rem' }}>
          <BrandLogo size={32} withText textClassName="footer-brand-text" />
        </p>
        <h1>Sign in</h1>
        <p className="muted">Publish products to Daraz and QuantumStore in one step.</p>
        <form onSubmit={handleSubmit}>
          <div className="auth-field">
            <label htmlFor="login-email">Email</label>
            <input
              id="login-email"
              className="input"
              type="email"
              autoComplete="email"
              autoFocus
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="auth-field">
            <label htmlFor="login-password">Password</label>
            <PasswordInput
              id="login-password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <AuthAlert>{error}</AuthAlert>}
          <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
            {submitting && <span className="btn-spinner" aria-hidden="true" />}
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </section>
  );
}
