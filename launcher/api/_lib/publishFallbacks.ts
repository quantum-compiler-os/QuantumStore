import { NO_BRAND, shouldRetryAsNoBrand, type DarazProductInput } from './darazCore.js';
import type { AttributeRole, Rewrite } from './listingAi.js';
import { MIN_DESCRIPTION_WORDS, countWords, isKeywordRefused, removeWords } from '../../shared/darazText.js';

export const NO_BRAND_NOTE = 'listed as No Brand';
export const STRIPPED_NOTE = 'brand name removed from the texts';

function mapStrings(values: Record<string, string>, fn: (text: string) => string) {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, fn(value)]));
}

/** The same listing with the given words taken out of every text Daraz screens. */
export function stripBrandWords(input: DarazProductInput, words: string[]): DarazProductInput {
  const clean = (text: string) => removeWords(text, words);
  return {
    ...input,
    name: clean(input.name),
    description: clean(input.description),
    shortDescription: input.shortDescription ? clean(input.shortDescription) : input.shortDescription,
    package: { ...input.package, content: clean(input.package.content) },
    attributes: mapStrings(input.attributes, clean),
  };
}

/** The AI's generic wording, put into the listing: the title, the description, the highlights and the English fields. */
export function applyRewrite(
  input: DarazProductInput,
  rewrite: Rewrite,
  roles: Record<string, AttributeRole | null> = {},
): DarazProductInput {
  const attributes = { ...input.attributes };
  for (const [name, role] of Object.entries(roles)) {
    if (role === 'name') attributes[name] = rewrite.name;
    else if (role === 'description') attributes[name] = rewrite.description;
    else if (role === 'highlights' && rewrite.highlights.length) attributes[name] = rewrite.highlights.join('\n');
  }
  return {
    ...input,
    name: rewrite.name,
    description: rewrite.description,
    shortDescription: rewrite.highlights.length
      ? `<ul>${rewrite.highlights.map((h) => `<li>${h.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</li>`).join('')}</ul>`
      : undefined,
    package: { ...input.package, content: rewrite.name },
    attributes,
  };
}

/** When the brand name is what Daraz may object to, the brand field is dropped along with it. */
function withoutBrand(input: DarazProductInput, changes: string[]): DarazProductInput {
  if (input.brand === NO_BRAND) return input;
  if (!changes.includes(NO_BRAND_NOTE)) changes.push(NO_BRAND_NOTE);
  return { ...input, brand: NO_BRAND };
}

type Options<T> = {
  input: DarazProductInput;
  attempt: (input: DarazProductInput) => Promise<T>;
  /** True for an error that is Daraz's own answer (anything else, like a dropped connection, is not retried here). */
  isRefusal: (err: unknown) => err is Error;
  /** Words (the brand) that may be what Daraz objects to. */
  brandWords: string[];
  /** Writes the listing again in generic words; absent when the AI is not set up. */
  rewrite?: (input: DarazProductInput) => Promise<Rewrite | null>;
  attributeRoles?: Record<string, AttributeRole | null>;
  log?: (text: string) => void;
};

/**
 * Creates the listing, and when Daraz refuses it for a reason that wording can fix, tries again with safer wording:
 *  1. brand refused (unknown or not authorized)        → the same listing as "No Brand"
 *  2. "not allowed to sell these keywords"             → the brand name removed from the texts (and "No Brand")
 *  3. still refused for keywords                       → the AI's generic title and description (and "No Brand")
 * Each step is tried once, in that order; anything else Daraz says is raised as it is. `changes` says what was altered.
 */
export async function createWithFallbacks<T>({
  input,
  attempt,
  isRefusal,
  brandWords,
  rewrite,
  attributeRoles,
  log = () => undefined,
}: Options<T>): Promise<{ created: T; changes: string[]; input: DarazProductInput }> {
  let current = input;
  const changes: string[] = [];
  let triedStrip = false;
  let triedRewrite = false;

  for (;;) {
    try {
      return { created: await attempt(current), changes, input: current };
    } catch (err) {
      if (!isRefusal(err)) throw err;

      if (current.brand !== NO_BRAND && shouldRetryAsNoBrand(err.message, current.brand)) {
        log(`brand "${current.brand}" refused by Daraz (${err.message}); retrying as No Brand`);
        current = { ...current, brand: NO_BRAND };
        changes.push(NO_BRAND_NOTE);
        continue;
      }

      if (isKeywordRefused(err.message)) {
        if (!triedStrip) {
          triedStrip = true;
          const stripped = stripBrandWords(current, brandWords);
          const changed = JSON.stringify(stripped) !== JSON.stringify(current);
          // Taking words out must not push the description under Daraz's minimum.
          if (changed && countWords(stripped.description) >= MIN_DESCRIPTION_WORDS) {
            log(`keywords refused by Daraz (${err.message}); retrying without the brand name in the texts`);
            changes.push(STRIPPED_NOTE);
            current = withoutBrand(stripped, changes);
            continue;
          }
        }
        if (!triedRewrite && rewrite) {
          triedRewrite = true;
          log(`keywords still refused (${err.message}); asking the AI for a generic title and description`);
          const written = await rewrite(current).catch((rewriteError: unknown) => {
            log(`the AI rewrite failed: ${rewriteError instanceof Error ? rewriteError.message : rewriteError}`);
            return null;
          });
          if (written) {
            changes.push(`generic title "${written.name}"`);
            current = withoutBrand(applyRewrite(current, written, attributeRoles), changes);
            continue;
          }
        }
      }
      throw err;
    }
  }
}
