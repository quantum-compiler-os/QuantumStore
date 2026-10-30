import { describe, expect, it } from 'vitest';
import { MIN_DESCRIPTION_WORDS, countWords, descriptionForDaraz, descriptionProblem, isBrandNotAuthorized } from '../shared/darazText';

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

describe('countWords', () => {
  it('counts words, ignoring punctuation and extra spaces', () => {
    expect(countWords('Prism 600 Sound Bar, with Woofer (2.1 Channel).')).toBe(9);
    expect(countWords('  ')).toBe(0);
    expect(countWords('')).toBe(0);
  });
});

describe('descriptionForDaraz', () => {
  const specs = [
    { key: 'Power', value: '40W' },
    { key: 'Battery', value: '4000 mAh' },
  ];

  it('leaves a description that is long enough exactly as it is', () => {
    const long = words(MIN_DESCRIPTION_WORDS);
    expect(descriptionForDaraz({ description: long, aiDescription: 'ignored', specs })).toBe(long);
  });

  it('adds the AI text first, and stops once it is long enough', () => {
    const ai = words(40);
    const text = descriptionForDaraz({ description: 'Max Speaker by Audionic.', aiDescription: ai, specs });
    expect(text).toBe(`Max Speaker by Audionic. ${ai}`);
    expect(text).not.toContain('Key details');
    expect(descriptionProblem(text)).toBe('');
  });

  it('falls back to the specifications when there is no AI text', () => {
    const text = descriptionForDaraz({
      description: 'Max Speaker by Audionic.',
      specs: Array.from({ length: 6 }, (_, i) => ({ key: `Feature ${i}`, value: 'a fairly descriptive value for it' })),
    });
    expect(text).toMatch(/^Max Speaker by Audionic\. Key details — Feature 0: a fairly descriptive value for it\. Feature 1:/);
    expect(descriptionProblem(text)).toBe('');
  });

  it('does not invent filler: with nothing to add, the description stays short and is reported', () => {
    const text = descriptionForDaraz({ description: 'Max Speaker by Audionic.' });
    expect(text).toBe('Max Speaker by Audionic.');
    expect(descriptionProblem(text)).toMatch(/at least 30 words.*has 4/);
  });

  it('does not repeat the AI text when the description already contains it', () => {
    const ai = words(10);
    expect(descriptionForDaraz({ description: `Intro ${ai}`, aiDescription: ai })).toBe(`Intro ${ai}`);
  });
});

describe('isBrandNotAuthorized', () => {
  it('recognises Daraz\'s brand policy refusal, however it is spelled', () => {
    expect(isBrandNotAuthorized('Apologies ! You are not authorized to sell this brand.')).toBe(true);
    expect(isBrandNotAuthorized('you are not authorised to sell this brand')).toBe(true);
    expect(isBrandNotAuthorized('package weight is invalid')).toBe(false);
  });
});
