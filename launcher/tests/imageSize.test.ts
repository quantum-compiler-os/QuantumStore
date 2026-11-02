import { describe, expect, it } from 'vitest';
import { enlargedSize, MIN_IMAGE_SIDE, pastedImages } from '../src/features/products/imageSize';

describe('pastedImages', () => {
  const screenshot = new File(['x'], 'image.png', { type: 'image/png' });
  const notes = new File(['x'], 'notes.txt', { type: 'text/plain' });

  it('takes a screenshot wherever it is pasted', () => {
    expect(pastedImages([screenshot], '', false)).toEqual([screenshot]);
    expect(pastedImages([screenshot], '', true)).toEqual([screenshot]);
  });

  it('leaves text with a picture alongside it to the text field', () => {
    expect(pastedImages([screenshot], 'Cell text', true)).toEqual([]);
    expect(pastedImages([screenshot], 'Cell text', false)).toEqual([screenshot]);
  });

  it('ignores everything that is not an image', () => {
    expect(pastedImages([notes], '', false)).toEqual([]);
    expect(pastedImages([], 'https://example.com/a.jpg', false)).toEqual([]);
  });
});

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
