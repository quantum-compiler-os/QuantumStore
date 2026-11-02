import { describe, expect, it } from 'vitest';
import { enlargedSize, MIN_IMAGE_SIDE } from '../src/features/products/imageSize';

describe('enlargedSize', () => {
  it('brings both sides of a small image up to the Daraz minimum, keeping its shape', () => {
    const size = enlargedSize(311, 302);
    expect(size).toEqual({ width: 340, height: 330 });
  });

  it('leaves images that already reach the minimum alone', () => {
    expect(enlargedSize(MIN_IMAGE_SIDE, MIN_IMAGE_SIDE)).toBeNull();
    expect(enlargedSize(1200, 800)).toBeNull();
  });

  it('enlarges when only one side is too short', () => {
    expect(enlargedSize(1000, 300)).toEqual({ width: 1100, height: 330 });
  });

  it('ignores an image with no size', () => {
    expect(enlargedSize(0, 0)).toBeNull();
  });
});
