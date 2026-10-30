export type CategoryIO = {
  list: () => Promise<Array<{ name: string }>>;
  create: (name: string) => Promise<{ name: string } | undefined>;
};

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Makes sure the store has a category called `name` (the backend rejects products whose category does
 * not exist) and returns the stored spelling.
 *
 * `shownNames` are the names the shop lists right now. The backend only shows its built-in names while its
 * category table is empty, so creating the first real category would silently drop them from the shop's
 * filters; in that case they are created first.
 */
export async function ensureStoreCategory(name: string, shownNames: string[], io: CategoryIO) {
  const wanted = name.trim();
  const rows = (await io.list()) || [];
  const existing = rows.find((row) => same(row.name, wanted));
  if (existing) return existing.name;

  if (rows.length === 0) {
    for (const builtIn of shownNames) {
      if (!same(builtIn, wanted)) await swallowDuplicate(() => io.create(builtIn));
    }
  }
  const created = await swallowDuplicate(() => io.create(wanted));
  return created?.name || wanted;
}

/** A parallel publish can create the same category first; "already exists" is then success. */
async function swallowDuplicate<T>(action: () => Promise<T>) {
  try {
    return await action();
  } catch (err) {
    const message = String(
      (err as { response?: { data?: { message?: string } } })?.response?.data?.message || (err as Error)?.message || '',
    );
    if (/already exists/i.test(message)) return undefined;
    throw err;
  }
}
