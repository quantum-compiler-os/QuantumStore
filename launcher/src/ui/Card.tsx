import type { ReactNode } from 'react';
import styles from './Card.module.css';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={[styles.card, className].filter(Boolean).join(' ')}>{children}</div>;
}

export function Badge({ children }: { children: ReactNode }) {
  return <span className={styles.badge}>{children}</span>;
}

export function Modal({
  open,
  onClose,
  children,
  title,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;
}) {
  if (!open) return null;
  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        {title ? <h2>{title}</h2> : null}
        {children}
      </div>
    </div>
  );
}
