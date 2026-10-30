import { createCategory, listCategories } from '../../api/categories';
import { ensureStoreCategory as ensure, type CategoryIO } from '../../../shared/ensureCategory';

const defaultIO: CategoryIO = { list: listCategories, create: createCategory };

// The logic lives in shared/ so the sync (server side) creates categories the same way.
export function ensureStoreCategory(name: string, shownNames: string[], io: CategoryIO = defaultIO) {
  return ensure(name, shownNames, io);
}
