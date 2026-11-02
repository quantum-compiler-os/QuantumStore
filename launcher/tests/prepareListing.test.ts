import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareListing } from '../api/_lib/prepareListing';

describe('prepareListing', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('accepts a long keyword-filled product name', async () => {
    vi.stubEnv('GROQ_API_KEY', '');
    await expect(prepareListing({ name: 'Hand Grip Strengthener '.repeat(15) })).resolves.toMatchObject({ category: null });
  });

  it('still asks for a name when there is none', async () => {
    await expect(prepareListing({ name: ' ' })).rejects.toThrow('Enter the product name first');
  });
});
