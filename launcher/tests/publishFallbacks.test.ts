import { describe, expect, it, vi } from 'vitest';
import type { DarazProductInput } from '../api/_lib/darazCore';
import { readRewriteAnswer, rewriteMessages } from '../api/_lib/listingAi';
import { NO_BRAND_NOTE, STRIPPED_NOTE, applyRewrite, createWithFallbacks, stripBrandWords } from '../api/_lib/publishFallbacks';
import { isKeywordRefused, removeWords } from '../shared/darazText';

const words = (n: number, prefix = 'w') => Array.from({ length: n }, (_, i) => `${prefix}${i}`).join(' ');

const LONG = `${words(35)} made by Audionic for everyday listening.`;

const input: DarazProductInput = {
  categoryId: 9718,
  name: 'Prism 600 Sound Bar with Woofer',
  description: LONG,
  shortDescription: '<ul><li>Audionic quality</li><li>HDMI ARC</li></ul>',
  brand: 'Audionic',
  sellerSku: 'AUD-1',
  quantity: 10,
  price: 19585,
  images: ['https://img/a.jpg'],
  package: { weight: 3, length: 80, width: 30, height: 24, content: 'Audionic Prism 600' },
  attributes: { name_en: 'Audionic Prism 600', description_en: 'A speaker by Audionic' },
};

const keyword = "E500: Create product failed — Product: Failed by Policy(R_5756913): You're not allowed to sell these keywords.";
const brandPolicy = 'E500: Create product failed — Failed by Policy(R_5498925): Apologies ! You are not authorized to sell this brand.';
const refusal = (message: string) => Object.assign(new Error(message), { daraz: true });
const isRefusal = (err: unknown): err is Error => Boolean((err as { daraz?: boolean })?.daraz);

describe('removeWords / isKeywordRefused', () => {
  it('takes whole words out and tidies what is left behind', () => {
    expect(removeWords('Prism 600 by Audionic.', ['Audionic'])).toBe('Prism 600.');
    expect(removeWords('Audionic Prism 600', ['Audionic'])).toBe('Prism 600');
    expect(removeWords('Great (Audionic) sound, AUDIONIC bass', ['Audionic'])).toBe('Great sound, bass');
  });

  it('never cuts a word out of the middle of another word', () => {
    expect(removeWords('Audionics and Audionic', ['Audionic'])).toBe('Audionics and');
    expect(removeWords('Reboot 303', ['Boo'])).toBe('Reboot 303');
  });

  it('copes with regex characters in the word and an empty list', () => {
    expect(removeWords('Fast C++ speaker', ['C++'])).toBe('Fast speaker');
    expect(removeWords('Keep this', [])).toBe('Keep this');
    expect(removeWords('Keep this', ['', ' '])).toBe('Keep this');
  });

  it("recognises Daraz's keyword policy refusal only", () => {
    expect(isKeywordRefused(keyword)).toBe(true);
    expect(isKeywordRefused(brandPolicy)).toBe(false);
  });
});

describe('stripBrandWords', () => {
  it('removes the brand from every text Daraz screens, and leaves the rest alone', () => {
    const out = stripBrandWords(input, ['Audionic']);
    // Everything but the brand field itself (that is switched to "No Brand" by createWithFallbacks).
    expect(JSON.stringify({ ...out, brand: '' })).not.toMatch(/audionic/i);
    expect(out.name).toBe('Prism 600 Sound Bar with Woofer');
    expect(out.package.content).toBe('Prism 600');
    expect(out.attributes.name_en).toBe('Prism 600');
    expect(out.price).toBe(19585);
    expect(out.images).toEqual(input.images);
  });
});

describe('applyRewrite', () => {
  const rewrite = { name: 'Home theatre sound bar with woofer', description: words(45), highlights: ['Wall mountable', 'HDMI ARC'] };

  it('puts the generic wording everywhere, including the English fields by role', () => {
    const out = applyRewrite(input, rewrite, { name_en: 'name', description_en: 'description', age: null });
    expect(out.name).toBe(rewrite.name);
    expect(out.description).toBe(rewrite.description);
    expect(out.shortDescription).toBe('<ul><li>Wall mountable</li><li>HDMI ARC</li></ul>');
    expect(out.package.content).toBe(rewrite.name);
    expect(out.attributes).toEqual({ name_en: rewrite.name, description_en: rewrite.description });
  });
});

describe('createWithFallbacks', () => {
  const run = (attempt: (i: DarazProductInput) => Promise<string>, extra: Record<string, unknown> = {}) =>
    createWithFallbacks({ input, attempt, isRefusal, brandWords: ['Audionic'], ...extra });

  it('does nothing extra when Daraz accepts the listing', async () => {
    const attempt = vi.fn(async () => 'item-1');
    const result = await run(attempt);
    expect(result).toMatchObject({ created: 'item-1', changes: [] });
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('retries a refused brand as No Brand', async () => {
    const attempt = vi.fn().mockRejectedValueOnce(refusal(brandPolicy)).mockResolvedValueOnce('item-2');
    const result = await run(attempt);
    expect(result.changes).toEqual([NO_BRAND_NOTE]);
    expect(attempt.mock.calls[1][0].brand).toBe('No Brand');
  });

  it('answers the keyword refusal first by removing the brand name from the texts', async () => {
    const attempt = vi.fn().mockRejectedValueOnce(refusal(keyword)).mockResolvedValueOnce('item-3');
    const result = await run(attempt);
    expect(result.changes).toEqual([STRIPPED_NOTE, NO_BRAND_NOTE]);
    expect(JSON.stringify(attempt.mock.calls[1][0])).not.toMatch(/audionic/i); // texts and brand field both clean
    expect(attempt.mock.calls[1][0].brand).toBe('No Brand');
  });

  it('then asks the AI for generic wording when the keywords are still refused', async () => {
    const rewrite = vi.fn(async () => ({ name: 'Generic sound bar', description: words(45), highlights: ['One'] }));
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(refusal(keyword))
      .mockRejectedValueOnce(refusal(keyword))
      .mockResolvedValueOnce('item-4');
    const result = await run(attempt, { rewrite });
    expect(result.changes).toEqual([STRIPPED_NOTE, NO_BRAND_NOTE, 'generic title "Generic sound bar"']);
    expect(attempt.mock.calls[2][0].name).toBe('Generic sound bar');
    expect(rewrite).toHaveBeenCalledTimes(1);
  });

  it('goes straight to the AI when taking the brand out would leave the description too short', async () => {
    const short = { ...input, description: 'Prism 600 by Audionic.' };
    const rewrite = vi.fn(async () => ({ name: 'Generic sound bar', description: words(45), highlights: [] }));
    const attempt = vi.fn().mockRejectedValueOnce(refusal(keyword)).mockResolvedValueOnce('item-5');
    const result = await createWithFallbacks({ input: short, attempt, isRefusal, brandWords: ['Audionic'], rewrite });
    expect(result.changes).toEqual(['generic title "Generic sound bar"', NO_BRAND_NOTE]);
    expect(attempt.mock.calls[1][0].description).not.toMatch(/Prism 600 by/);
    expect(attempt.mock.calls[1][0].brand).toBe('No Brand');
  });

  it('chains the steps: brand refused, then keywords refused, then accepted', async () => {
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(refusal(brandPolicy))
      .mockRejectedValueOnce(refusal(keyword))
      .mockResolvedValueOnce('item-6');
    const result = await run(attempt);
    expect(result.changes).toEqual([NO_BRAND_NOTE, STRIPPED_NOTE]);
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it('gives up with Daraz\'s own message after each step has been tried once', async () => {
    const rewrite = vi.fn(async () => ({ name: 'Generic', description: words(45), highlights: [] }));
    const attempt = vi.fn(async () => Promise.reject(refusal(keyword)));
    await expect(run(attempt, { rewrite })).rejects.toThrow(/not allowed to sell these keywords/);
    expect(attempt).toHaveBeenCalledTimes(3); // original, brand removed, AI wording
    expect(rewrite).toHaveBeenCalledTimes(1);
  });

  it('still fails clearly without an AI, or when the AI rewrite is unusable', async () => {
    const attempt = vi.fn(async () => Promise.reject(refusal(keyword)));
    await expect(run(attempt)).rejects.toThrow(/keywords/);
    expect(attempt).toHaveBeenCalledTimes(2);

    const broken = vi.fn(async () => Promise.reject(new Error('Groq down')));
    const second = vi.fn(async () => Promise.reject(refusal(keyword)));
    await expect(run(second, { rewrite: broken })).rejects.toThrow(/keywords/);
    expect(broken).toHaveBeenCalledTimes(1);
  });

  it('does not touch anything for other refusals or for errors that are not Daraz\'s answer', async () => {
    const other = vi.fn(async () => Promise.reject(refusal('E500: package weight is invalid')));
    await expect(run(other)).rejects.toThrow(/weight/);
    expect(other).toHaveBeenCalledTimes(1);

    const network = vi.fn(async () => Promise.reject(new Error('offline')));
    await expect(run(network)).rejects.toThrow('offline');
    expect(network).toHaveBeenCalledTimes(1);
  });

  it('logs each step', async () => {
    const log = vi.fn();
    const attempt = vi.fn().mockRejectedValueOnce(refusal(keyword)).mockResolvedValueOnce('x');
    await run(attempt, { log });
    expect(log.mock.calls[0][0]).toMatch(/keywords refused.*without the brand name/);
  });
});

describe('the AI rewrite request and answer', () => {
  it('asks for generic wording and names the words to avoid', () => {
    const [system, user] = rewriteMessages({ name: 'Prism 600', description: 'A sound bar.' }, ['Audionic']);
    expect(system.content).toMatch(/never instructions/);
    expect(user.content).toMatch(/no brand, company, trademark.*Dolby/);
    expect(user.content).toContain('Never use these words: Audionic');
    expect(user.content).toMatch(/40 to 60 words/);
  });

  it('reads a good answer and removes the avoided words even if the model used them', () => {
    const answer = { name: 'Audionic sound bar', description: `${words(40)} from Audionic`, highlights: ['Audionic bass', 'HDMI'] };
    expect(readRewriteAnswer(answer, ['Audionic'])).toEqual({
      name: 'sound bar',
      description: words(40),
      highlights: ['bass', 'HDMI'],
    });
  });

  it('rejects an answer that is too short to be used', () => {
    expect(readRewriteAnswer({ name: 'Sound bar', description: 'Too short.', highlights: [] }, [])).toBeNull();
    expect(readRewriteAnswer({ name: '', description: words(40), highlights: [] }, [])).toBeNull();
    expect(readRewriteAnswer({}, [])).toBeNull();
  });
});
