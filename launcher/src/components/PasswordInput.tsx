import { useState, type InputHTMLAttributes } from 'react';

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

export default function PasswordInput({ className = 'input', ...props }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="auth-input-wrap">
      <input {...props} className={className} type={visible ? 'text' : 'password'} />
      <button
        type="button"
        className="auth-reveal"
        onClick={() => setVisible((prev) => !prev)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        title={visible ? 'Hide password' : 'Show password'}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {visible ? (
            <>
              <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
              <path d="M9.4 5.2A9.5 9.5 0 0 1 12 4.9c5 0 9 4.4 9 7.1a11 11 0 0 1-2.4 3.4" />
              <path d="M6.2 6.7A11.3 11.3 0 0 0 3 12c0 2.7 4 7.1 9 7.1a9.7 9.7 0 0 0 4.3-1" />
              <path d="m3.5 3.5 17 17" />
            </>
          ) : (
            <>
              <path d="M3 12c0-2.7 4-7.1 9-7.1s9 4.4 9 7.1c0 2.7-4 7.1-9 7.1S3 14.7 3 12Z" />
              <circle cx="12" cy="12" r="2.6" />
            </>
          )}
        </svg>
      </button>
    </div>
  );
}
