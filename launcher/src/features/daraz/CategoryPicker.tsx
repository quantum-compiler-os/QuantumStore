import { useMemo, useState } from 'react';
import type { DarazCategoryLeaf } from '../../api/daraz';
import { commissionFor, filterLeaves, groupOf, groupsFromLeaves } from './categoryGroups';
import Field from './Field';

const PAGE_SIZE = 60;
const SEPARATOR = ' › ';

type Props = {
  leaves: DarazCategoryLeaf[] | undefined;
  loading: boolean;
  error: string;
  selectedId: number | null;
  selectedPath: string;
  onSelect: (leaf: DarazCategoryLeaf) => void;
};

/** "Men Bags › Business Bags" → parents "Bags and Travel › Men Bags", leaf "Business Bags". */
function splitPath(path: string) {
  const parts = path.split(SEPARATOR);
  const leaf = parts.pop() || path;
  return { parents: parts.join(SEPARATOR), leaf };
}

export default function CategoryPicker({ leaves, loading, error, selectedId, selectedPath, onSelect }: Props) {
  const [group, setGroup] = useState(() => (selectedPath ? groupOf(selectedPath) : ''));
  const [query, setQuery] = useState('');
  const [changing, setChanging] = useState(false);

  const groups = useMemo(() => groupsFromLeaves(leaves || []), [leaves]);
  const all = useMemo(
    () => filterLeaves(leaves || [], group, query, Number.MAX_SAFE_INTEGER),
    [leaves, group, query],
  );
  const shown = all.slice(0, PAGE_SIZE);
  const groupCommission = group ? commissionFor(group) : null;

  if (selectedId !== null && selectedPath && !changing) {
    const { parents, leaf } = splitPath(selectedPath);
    const commission = commissionFor(groupOf(selectedPath));
    return (
      <div className="cat-selected">
        <div>
          {parents && <div className="cat-crumbs">{parents}</div>}
          <div className="cat-leaf">{leaf}</div>
        </div>
        <div className="cat-meta">
          {commission !== null && <span className="badge">{commission.toFixed(2)}% Daraz commission</span>}
          <button type="button" className="btn btn-ghost" onClick={() => setChanging(true)}>
            Change
          </button>
        </div>
      </div>
    );
  }

  function pick(leaf: DarazCategoryLeaf) {
    onSelect(leaf);
    setGroup(groupOf(leaf.path));
    setQuery('');
    setChanging(false);
  }

  return (
    <div className="cat-picker">
      <div className="cat-controls">
        <Field
          label="Category group"
          hint={
            groupCommission !== null
              ? `Daraz commission for this group: ${groupCommission.toFixed(2)}%`
              : 'Narrow the list to one part of Daraz'
          }
        >
          <select
            className="input"
            value={group}
            disabled={!leaves}
            onChange={(e) => {
              setGroup(e.target.value);
              setQuery('');
            }}
          >
            <option value="">{leaves ? 'All groups' : 'Loading…'}</option>
            {groups.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Search" hint="Type part of a category name, e.g. earbuds or business bags">
          <input
            className="input"
            type="search"
            placeholder={group ? `Search in ${group}` : 'Search all categories'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </Field>
      </div>

      {error && <p className="form-error">{error}</p>}
      {!error && loading && <p className="cat-empty">Loading Daraz categories…</p>}
      {!error && !loading && leaves && !group && !query.trim() && (
        <p className="cat-empty">Choose a group or start typing to see categories.</p>
      )}
      {!error && !loading && leaves && (group || query.trim()) && shown.length === 0 && (
        <p className="cat-empty">No category matches that search{group ? ' in this group' : ''}.</p>
      )}

      {shown.length > 0 && (
        <>
          <ul className="cat-results">
            {shown.map((leaf) => {
              const { parents, leaf: name } = splitPath(leaf.path);
              return (
                <li key={leaf.id}>
                  <button type="button" className="cat-option" onClick={() => pick(leaf)}>
                    {parents && <span className="cat-option-path">{parents}</span>}
                    <span className="cat-option-leaf">{name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {all.length > shown.length && (
            <p className="field-hint">
              Showing the first {shown.length} of {all.length} — type to narrow it down.
            </p>
          )}
        </>
      )}

      {changing && (
        <div>
          <button type="button" className="text-btn" onClick={() => setChanging(false)}>
            Keep the current category
          </button>
        </div>
      )}
    </div>
  );
}
