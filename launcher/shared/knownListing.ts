import data from './audionicListing.json';
import { MIN_DESCRIPTION_WORDS, countWords } from './darazText';

/**
 * Daraz listing text and package size written ahead of time for Audionic products (shared/audionicListing.json, keyed by
 * Audionic's product id). When a product has an entry the AI is not asked for these parts.
 */
export type KnownListing = {
  description: string;
  highlights: string[];
  package: { weightKg: number; lengthCm: number; widthCm: number; heightCm: number };
};

export function knownListingFor(audionicId: string): KnownListing | undefined {
  return (data as Record<string, KnownListing>)[audionicId];
}

const positive = (value: unknown, max: number) => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= max;

/** The entry if it is complete and sensible, otherwise null (it also checks what a browser sends to the server). */
export function readKnownListing(raw: unknown): KnownListing | null {
  if (!raw || typeof raw !== 'object') return null;
  const { description, highlights, package: pkg } = raw as Record<string, unknown>;
  if (typeof description !== 'string' || countWords(description) < MIN_DESCRIPTION_WORDS || description.length > 2000) return null;
  if (!Array.isArray(highlights) || highlights.length > 6 || highlights.some((h) => typeof h !== 'string' || !h.trim() || h.length > 300)) return null;
  if (!pkg || typeof pkg !== 'object') return null;
  const { weightKg, lengthCm, widthCm, heightCm } = pkg as Record<string, unknown>;
  if (!positive(weightKg, 100) || !positive(lengthCm, 300) || !positive(widthCm, 300) || !positive(heightCm, 300)) return null;
  return { description: description.trim(), highlights: highlights as string[], package: { weightKg, lengthCm, widthCm, heightCm } as KnownListing['package'] };
}
