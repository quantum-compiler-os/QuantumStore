import type { ReactNode } from 'react';

type Props = {
  label: string;
  required?: boolean;
  /** Small helper text under the input, so long explanations never stretch the label row. */
  hint?: ReactNode;
  children: ReactNode;
};

/** Label, control and hint stacked in a fixed order so neighbouring inputs always line up. */
export default function Field({ label, required, hint, children }: Props) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        {required && (
          <span className="req" aria-hidden="true">
            {' '}
            *
          </span>
        )}
      </span>
      {children}
      {hint && <small className="field-hint">{hint}</small>}
    </label>
  );
}
