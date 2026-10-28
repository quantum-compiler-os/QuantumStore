import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

type ConfirmOptions = {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'default';
};

type ConfirmRequest = {
  message: string;
  options: ConfirmOptions;
  resolve: (value: boolean) => void;
};

type ConfirmFn = (message: string, options?: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);

  const confirm = useCallback<ConfirmFn>((message, options = {}) => {
    return new Promise((resolve) => {
      setRequest({ message, options, resolve });
    });
  }, []);

  const settle = useCallback(
    (value: boolean) => {
      request?.resolve(value);
      setRequest(null);
    },
    [request]
  );

  useEffect(() => {
    if (!request) return undefined;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') settle(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [request, settle]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {request && (
        <div className="confirm-overlay" onMouseDown={() => settle(false)}>
          <div
            className="confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <p className="confirm-dialog-title" id="confirm-dialog-title">
              {request.options.title || 'Are you sure?'}
            </p>
            <p className="confirm-dialog-message">{request.message}</p>
            <div className="confirm-dialog-actions">
              <button type="button" className="btn btn-ghost" onClick={() => settle(false)}>
                {request.options.cancelLabel || 'Cancel'}
              </button>
              <button
                type="button"
                className={request.options.tone === 'danger' ? 'btn btn-danger' : 'btn btn-primary'}
                autoFocus
                onClick={() => settle(true)}
              >
                {request.options.confirmLabel || 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider');
  return ctx;
}
