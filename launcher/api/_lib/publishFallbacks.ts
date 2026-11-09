import { NO_BRAND, shouldRetryAsNoBrand, type DarazProductInput } from './darazCore.js';
import type { AttributeRole, Rewrite } from './listingAi.js';
import { MIN_DESCRIPTION_WORDS, countWords, isBrandNotAuthorized, isKeywordRefused, isTitleRefused, removeWords } from '../../shared/darazText.js';

export const NO_BRAND_NOTE = 'listed as No Brand';
export const STRIPPED_NOTE = 'brand name removed from the texts';
// The AI rewrite asks for a title of at most this length too.
const SHORT_TITLE = 100;

/** The name cut at a word boundary to a length Daraz takes, without a dangling separator. */
export function shortenTitle(name: string) {
  if (name.length <= SHORT_TITLE) return name;
  const cut = name.slice(0, SHORT_TITLE + 1);
  const space = cut.lastIndexOf(' ');
  return (space > SHORT_TITLE / 2 ? cut.slice(0, space) : name.slice(0, SHORT_TITLE)).replace(/[\s\-–|,(/+&]+$/, '');
}

/** The same listing under a new title, wherever the title appears. */
function withTitle(input: DarazProductInput, title: string, roles: Record<string, AttributeRole | null> = {}): DarazProductInput {
  const attributes = { ...input.attributes };
  for (const [name, role] of Object.entries(roles)) if (role === 'name') attributes[name] = title;
  return { ...input, name: title, package: { ...input.package, content: title }, attributes };
}

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
 *  2. "not allowed to sell these keywords", or the brand
 *     still refused as No Brand (spotted in the title)  → the brand name removed from the texts (and "No Brand")
 *  3. still refused                                    → the AI's generic title and description (and "No Brand")
 *  4. title refused (blank or too long)                → the AI's generic wording, or without an AI the name shortened
 * Each step is tried once; anything else Daraz says is raised as it is. `changes` says what was altered.
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
  let triedTitle = false;

  async function askRewrite() {
    triedRewrite = true;
    return rewrite
      ? rewrite(current).catch((rewriteError: unknown) => {
          log(`the AI rewrite failed: ${rewriteError instanceof Error ? rewriteError.message : rewriteError}`);
          return null;
        })
      : null;
  }

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

      // Still "not authorized to sell this brand" as No Brand: Daraz is spotting the brand in the title or texts,
      // so it is handled like refused keywords — the brand name taken out, then the AI's generic wording.
      const brandInTexts = current.brand === NO_BRAND && isBrandNotAuthorized(err.message);
      if (isKeywordRefused(err.message) || brandInTexts) {
        const what = brandInTexts ? 'brand still refused as No Brand' : 'keywords refused by Daraz';
        if (!triedStrip) {
          triedStrip = true;
          const stripped = stripBrandWords(current, brandWords);
          const changed = JSON.stringify(stripped) !== JSON.stringify(current);
          // Taking words out must not push the description under Daraz's minimum.
          if (changed && countWords(stripped.description) >= MIN_DESCRIPTION_WORDS) {
            log(`${what} (${err.message}); retrying without the brand name in the title and texts`);
            changes.push(STRIPPED_NOTE);
            current = withoutBrand(stripped, changes);
            continue;
          }
        }
        if (!triedRewrite && rewrite) {
          log(`${what} again (${err.message}); asking the AI for a generic title and description`);
          const written = await askRewrite();
          if (written) {
            changes.push(`generic title "${written.name}"`);
            current = withoutBrand(applyRewrite(current, written, attributeRoles), changes);
            continue;
          }
        }
      }

      if (isTitleRefused(err.message) && !triedTitle) {
        triedTitle = true;
        if (!triedRewrite && rewrite) {
          log(`title refused (${err.message}); asking the AI for a shorter title`);
          const written = await askRewrite();
          if (written) {
            changes.push(`generic title "${written.name}"`);
            current = applyRewrite(current, written, attributeRoles);
            continue;
          }
        }
        const short = shortenTitle(current.name);
        if (short !== current.name) {
          log(`title refused (${err.message}); retrying with the name shortened to ${short.length} characters`);
          changes.push(`shortened title "${short}"`);
          current = withTitle(current, short, attributeRoles);
          continue;
        }
      }
      throw err;
    }
  }
}
