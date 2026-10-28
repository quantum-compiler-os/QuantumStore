import type { ReactNode } from 'react';

export default function AuthAlert({ children }: { children: ReactNode }) {
  return (
    <p className="auth-alert auth-alert-error" role="alert">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v4.5" />
        <path d="M12 16h.01" />
      </svg>
      <span>{children}</span>
    </p>
  );
}
