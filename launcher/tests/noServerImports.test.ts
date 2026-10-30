import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve('.');
const SERVER_DIR = join(ROOT, 'api');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/** Relative paths in `file` that are real (not type-only) imports of something inside the server folder `api/`. */
export function serverValueImports(file: string, source: string) {
  const found: string[] = [];
  for (const match of source.matchAll(/import\s+(type\s+)?([^;]*?)\s+from\s+['"]([^'"]+)['"]/g)) {
    const [, typeOnly, clause, from] = match;
    if (!from.startsWith('.')) continue;
    const target = resolve(dirname(file), from);
    if (target !== SERVER_DIR && !target.startsWith(SERVER_DIR + sep)) continue;
    // `import { type A, type B }` is erased too; a clause with any plain name is a real import.
    const onlyTypes = Boolean(typeOnly) || /^\{(\s*type\s+[\w$]+\s*,?)+\s*\}$/.test(clause.trim());
    if (!onlyTypes) found.push(from);
  }
  return found;
}

describe('the browser code (src/) never loads anything from the server folder api/', () => {
  it('has no value import from launcher/api (the dev server forwards /api/* to the backend, so the page would stay blank)', () => {
    const offenders = files(join(ROOT, 'src')).flatMap((file) =>
      serverValueImports(file, readFileSync(file, 'utf8')).map((from) => `${file.replace(/\\/g, '/')} imports ${from}`),
    );
    expect(offenders).toEqual([]);
  });

  it('tells a type import, a real import and src/api apart', () => {
    const file = join(ROOT, 'src', 'features', 'x', 'y.ts');
    expect(serverValueImports(file, "import type { A } from '../../../api/_lib/x';")).toEqual([]);
    expect(serverValueImports(file, "import { type A, type B } from '../../../api/_lib/x';")).toEqual([]);
    expect(serverValueImports(file, "import { A } from '../../../api/_lib/x';")).toEqual(['../../../api/_lib/x']);
    expect(serverValueImports(file, "import { type A, b } from '../../../api/_lib/x';")).toEqual(['../../../api/_lib/x']);
    // src/api/ is the browser's own folder, and shared/ is meant to be imported from both sides.
    expect(serverValueImports(file, "import api from '../../api/client';")).toEqual([]);
    expect(serverValueImports(file, "import { f } from '../../../shared/darazText';")).toEqual([]);
  });
});
