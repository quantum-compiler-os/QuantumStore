import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './Button.module.css';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  block?: boolean;
  children: ReactNode;
};

export function Button({ variant = 'primary', block, className = '', children, ...rest }: Props) {
  return (
    <button
      className={[styles.btn, styles[variant], block ? styles.block : '', className].filter(Boolean).join(' ')}
      {...rest}
    >
      {children}
    </button>
  );
}

export default Button;
