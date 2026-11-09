/**
 * Text rules shared by the Launcher server (api/) and the browser (src/). Two rules for this folder:
 *  - nothing here may import a Node module (api/_lib/darazCore.ts pulls in node:crypto and must stay server-only);
 *  - the browser must never import anything from api/: the dev server forwards every /api/... address to the
 *    QuantumStore backend, so such an import 404s and the page stays blank (tests/noServerImports.test.ts guards this).
 */

/** Daraz refuses a "Product Description" shorter than this. */
export const MIN_DESCRIPTION_WORDS = 30;

/**
 * Daraz's brand-protection policy ("You are not authorized to sell this brand"). The brand exists and is protected, so
 * this is a permission the seller has to obtain from Daraz (brand authorization in Seller Center), not a typo to retry.
 */
export function isBrandNotAuthorized(message: string) {
  return /not authori[sz]ed to sell this brand/i.test(message);
}

export function countWords(text: string) {
  return (String(text || '').match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
}

type Spec = { key: string; value: string };

/**
 * The text for Daraz's description: the product's own description first, then (only while it is still under the
 * minimum) the AI-written one, then a short list of its specifications. Real information only, never filler.
 */
export function descriptionForDaraz({
  description,
  aiDescription = '',
  specs = [],
}: {
  description: string;
  aiDescription?: string;
  specs?: Spec[];
}) {
  const parts = [description.trim()];
  const words = () => countWords(parts.join(' '));

  const ai = aiDescription.trim();
  if (words() < MIN_DESCRIPTION_WORDS && ai && !parts[0].includes(ai)) parts.push(ai);

  if (words() < MIN_DESCRIPTION_WORDS && specs.length) {
    const details = specs
      .slice(0, 8)
      .map((s) => `${s.key}: ${s.value}`)
      .join('. ');
    parts.push(`Key details — ${details}.`);
  }
  return parts.filter(Boolean).join(' ');
}

/** '' when the description is long enough, otherwise what to tell the seller. */
export function descriptionProblem(text: string) {
  const words = countWords(text);
  return words >= MIN_DESCRIPTION_WORDS
    ? ''
    : `Daraz needs at least ${MIN_DESCRIPTION_WORDS} words in the description (this one has ${words}). Add more detail about the product.`;
}

/** Daraz's keyword policy ("You're not allowed to sell these keywords"). It does not say which keyword. */
export function isKeywordRefused(message: string) {
  return /not allowed to sell these keywords/i.test(message);
}

/**
 * Daraz's risk policy refusing one product ("Failed by Policy(R_4862749): You are not authorized to sell these
 * products", "...not allowed to sell this on the platform"): usually a protected title or publisher. A rule for that
 * product, not a fault to retry. Check brand and keyword refusals first; they are more specific.
 */
export function isProductPolicyRefused(message: string) {
  return /Failed by Policy\(R_\d+\)|not authori[sz]ed to sell these products|not allowed to sell this on the platform/i.test(message);
}

/** Daraz refusing the product title ("title: C004: cannot be blank" for a 227-character name, or a length complaint). */
export function isTitleRefused(message: string) {
  return /\btitle\b[^.]*(cannot be blank|too long|length|exceed)/i.test(message);
}

const escapeRegExp =(text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Accented forms of each plain letter, so the brand "RODE" also matches "Røde" and "Rōde" in a title. */
const LETTER_VARIANTS: Record<string, string> = {
  a: 'aàáâãäåāą',
  c: 'cçćč',
  e: 'eèéêëēęě',
  i: 'iìíîïī',
  n: 'nñńň',
  o: 'oòóôõöøō',
  s: 'sśšş',
  u: 'uùúûüū',
  y: 'yýÿ',
  z: 'zźżž',
};
const BASE_LETTER: Record<string, string> = Object.fromEntries(
  Object.entries(LETTER_VARIANTS).flatMap(([base, all]) => [...all].map((ch) => [ch, base])),
);

/** A regex source for `word` that ignores accents (each letter matches its accented forms). */
function accentInsensitive(word: string) {
  return [...word]
    .map((ch) => {
      const base = BASE_LETTER[ch.toLowerCase()];
      return base ? `[${LETTER_VARIANTS[base]}]` : escapeRegExp(ch);
    })
    .join('');
}

/** Takes whole words out of a text ("… by Audionic." → "…"), then tidies the spaces and punctuation left behind. */
export function removeWords(text: string, words: string[]) {
  let out = String(text || '');
  for (const word of words.map((w) => w.trim()).filter((w) => w.length >= 2)) {
    const w = accentInsensitive(word);
    out = out.replace(new RegExp(`\\s+(by|from|of)\\s+${w}(?![\\p{L}\\p{N}])`, 'giu'), '');
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${w}(?![\\p{L}\\p{N}])`, 'giu'), '');
  }
  return out
    .replace(/\(\s*\)/g, '')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/([.,;:!?])(?:\s*[.,;:!?])+/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
