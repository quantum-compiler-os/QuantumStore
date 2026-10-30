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

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Takes whole words out of a text ("… by Audionic." → "…"), then tidies the spaces and punctuation left behind. */
export function removeWords(text: string, words: string[]) {
  let out = String(text || '');
  for (const word of words.map((w) => w.trim()).filter((w) => w.length >= 2)) {
    const w = escapeRegExp(word);
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
