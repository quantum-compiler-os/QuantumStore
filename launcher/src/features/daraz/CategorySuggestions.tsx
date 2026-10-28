import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { suggestDarazCategories, type CategorySuggestion } from '../../api/daraz';
import { getErrorMessage } from '../../utils/errors';
import { commissionFor, groupOf } from './categoryGroups';

const AUTO_DELAY_MS = 900;
const MIN_NAME_LENGTH = 4;
const SEPARATOR = ' › ';

type Props = {
  name: string;
  brand: string;
  description: string;
  /** False when the server has no GROQ_API_KEY. */
  enabled: boolean;
  /** A category is already chosen, so suggestions only run when asked for. */
  hasSelection: boolean;
  onPick: (leaf: CategorySuggestion) => void;
};

/** Groq-backed category suggestions for the product name, with a one-click pick. */
export default function CategorySuggestions({ name, brand, description, enabled, hasSelection, onPick }: Props) {
  const [results, setResults] = useState<CategorySuggestion[] | null>(null);
  const [error, setError] = useState('');
  const lastAsked = useRef('');
  const trimmed = name.trim();

  const mutation = useMutation({
    mutationFn: () => suggestDarazCategories({ name: trimmed, brand: brand.trim(), description: description.trim() }),
    onSuccess: (data) => {
      setResults(data.suggestions);
      setError('');
    },
    onError: (err) => {
      setResults(null);
      setError(getErrorMessage(err, 'Could not get suggestions'));
    },
  });
  const { mutate } = mutation;

  function ask() {
    lastAsked.current = trimmed;
    mutate();
  }

  // Ask once the name stops changing, but only while no category has been chosen and only once per name.
  useEffect(() => {
    if (!enabled || hasSelection || trimmed.length < MIN_NAME_LENGTH || trimmed === lastAsked.current) return undefined;
    const timer = setTimeout(() => {
      lastAsked.current = trimmed;
      mutate();
    }, AUTO_DELAY_MS);
    return () => clearTimeout(timer);
  }, [enabled, hasSelection, trimmed, mutate]);

  if (!enabled) {
    return (
      <p className="field-hint" style={{ margin: 0 }}>
        Want the category suggested from the product name? Add <code>GROQ_API_KEY</code> to <code>launcher/.env</code> and
        restart the Launcher.
      </p>
    );
  }

  return (
    <div className="cat-suggest" aria-live="polite">
      <div className="cat-suggest-head">
        <strong>Suggested for this product</strong>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={mutation.isPending || trimmed.length < 2}
          onClick={ask}
        >
          {mutation.isPending ? 'Thinking…' : results ? 'Suggest again' : 'Suggest from the name'}
        </button>
      </div>

      {!results && !mutation.isPending && !error && (
        <p className="field-hint" style={{ margin: 0 }}>
          {trimmed.length < MIN_NAME_LENGTH
            ? 'Type the product name above and a category is suggested automatically.'
            : 'Press the button to get suggestions.'}
        </p>
      )}
      {error && <p className="form-error" style={{ margin: 0 }}>{error}</p>}
      {results && results.length === 0 && (
        <p className="field-hint" style={{ margin: 0 }}>
          No confident match — pick a group and search below.
        </p>
      )}
      {results && results.length > 0 && (
        <ul className="cat-suggest-list">
          {results.map((suggestion) => {
            const parts = suggestion.path.split(SEPARATOR);
            const leaf = parts.pop() || suggestion.name;
            const commission = commissionFor(groupOf(suggestion.path));
            return (
              <li key={suggestion.id}>
                <button
                  type="button"
                  className="cat-option"
                  onClick={() => {
                    onPick(suggestion);
                    setResults(null);
                  }}
                >
                  <span className="cat-option-text">
                    {parts.length > 0 && <span className="cat-option-path">{parts.join(SEPARATOR)}</span>}
                    <span className="cat-option-leaf">{leaf}</span>
                  </span>
                  {commission !== null && <span className="badge">{commission.toFixed(2)}%</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
