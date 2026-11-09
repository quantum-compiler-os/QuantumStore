import type { DarazCategoryLeaf } from '../../api/daraz';
import { PATH_SEPARATOR } from '../daraz/categoryGroups';

/** The same SKU every time for the same PakBooks book, so Daraz rejects a duplicate instead of listing it twice. */
export const pakbooksSku = (pakbooksId: string) => `PB-${pakbooksId}`;

/** PakBooks publishes and sells in Pakistan: its books go under Daraz's "Local Books" (not "English" or "Chinese Books"). */
const SHELF = 'Local Books';

// The Daraz category for each book type, by the category's own name under "Media, Music & Books › Books › Local Books"
// (read from Daraz's category tree). Daraz has no plain "Fiction" category: novels and poetry are "Literature", and
// "Comic Books" means comics, so humour is "Entertainment Books". The first name found wins; the choice is shown in
// the picker on the PakBooks page and can still be changed there.
const RULES: Record<string, string[]> = {
  'Quran & Tafseer': ['Religion Books'],
  'Hadith & Seerat': ['Religion Books'],
  'Islam & Religion': ['Religion Books'],
  "Children's Books": ["Children's Books"],
  Textbooks: ['High School', 'Study Aids & Exam Preparations', 'Education Books'],
  Education: ['Education Books'],
  Fiction: ['Literature'],
  'Poetry & Drama': ['Literature'],
  Biography: ['Biography Books'],
  Travel: ['Travel Books'],
  Humour: ['Entertainment Books', 'Literature'],
  'History & Politics': ['History Books'],
  'Literature & Languages': ['Literature'],
  'Self-Help': ['Self Help'],
  'Health & Medicine': ['Medical Books', 'Fitness Books'],
  'Science & Technology': ['Science Books', 'Technology Books'],
  'Business & Law': ['Business Books', 'Law Books'],
  'Philosophy & Social Sciences': ['Social Books'],
  'Art & Photography': ['Art Books'],
  Cooking: ['Cooking Books'],
  Reference: ['Dictionaries', 'Education Books'],
  // Untagged books are mostly Urdu prose and poetry.
  Books: ['Literature'],
};
const LAST_RESORT = ['Literature'];

const parts = (path: string) => path.split(PATH_SEPARATOR).map((p) => p.trim().toLowerCase());

export function pakbooksFallbackCategory(type: string, leaves: DarazCategoryLeaf[]): DarazCategoryLeaf | null {
  const local = leaves.filter((leaf) => parts(leaf.path).includes(SHELF.toLowerCase()));
  for (const name of [...(RULES[type] ?? []), ...LAST_RESORT]) {
    const hit = local.find((leaf) => parts(leaf.path).pop() === name.toLowerCase());
    if (hit) return hit;
  }
  return null;
}
