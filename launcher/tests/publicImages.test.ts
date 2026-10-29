import { describe, expect, it, vi } from 'vitest';
import { ensurePublicImages, isPublicUrl } from '../src/features/products/publicImages';

const blob = new Blob(['x'], { type: 'image/webp' });

describe('ensurePublicImages', () => {
  it('leaves https images alone without calling the backend', async () => {
    const download = vi.fn();
    const upload = vi.fn();
    const images = [{ url: 'https://lh3.googleusercontent.com/d/a.webp', thumbnail: 'https://lh3.googleusercontent.com/d/a-t.webp' }];
    const result = await ensurePublicImages(images, { download, upload });
    expect(result).toEqual({ images, changed: false });
    expect(download).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it('uploads a local image again and keeps the order', async () => {
    const download = vi.fn(async () => blob);
    const upload = vi.fn(async () => ({ url: 'https://lh3.googleusercontent.com/d/new.webp', thumbnail: 'https://lh3.googleusercontent.com/d/new-t.webp' }));
    const result = await ensurePublicImages(
      [
        { url: '/uploads/old.webp', thumbnail: '/uploads/old-thumb.webp' },
        { url: 'https://lh3.googleusercontent.com/d/b.webp', thumbnail: 'https://lh3.googleusercontent.com/d/b.webp' },
      ],
      { download, upload },
    );
    expect(download).toHaveBeenCalledWith('/uploads/old.webp');
    expect(result.changed).toBe(true);
    expect(result.images.map((i) => i.url)).toEqual(['https://lh3.googleusercontent.com/d/new.webp', 'https://lh3.googleusercontent.com/d/b.webp']);
  });

  it('explains the storage setting when the backend still answers with a local address', async () => {
    const deps = { download: async () => blob, upload: async () => ({ url: '/uploads/again.webp' }) };
    await expect(ensurePublicImages([{ url: '/uploads/old.webp', thumbnail: '' }], deps)).rejects.toThrow(/STORAGE_DRIVER=gdrive/);
  });

  it('reports an image that cannot be read back', async () => {
    const deps = {
      download: async () => {
        throw new Error('404');
      },
      upload: vi.fn(),
    };
    await expect(ensurePublicImages([{ url: '/uploads/gone.webp', thumbnail: '' }], deps)).rejects.toThrow(/remove the image/);
    expect(deps.upload).not.toHaveBeenCalled();
  });
});

describe('isPublicUrl', () => {
  it('accepts only https addresses', () => {
    expect(isPublicUrl('https://x.com/a.jpg')).toBe(true);
    expect(isPublicUrl('http://x.com/a.jpg')).toBe(false);
    expect(isPublicUrl('/uploads/a.webp')).toBe(false);
  });
});
