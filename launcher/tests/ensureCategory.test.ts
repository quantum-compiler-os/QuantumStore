import { describe, expect, it } from 'vitest';
import { ensureStoreCategory } from '../src/features/products/ensureCategory';

function fakeStore(initial: string[]) {
  const rows = initial.map((name, i) => ({ _id: String(i), name }));
  const created: string[] = [];
  return {
    created,
    io: {
      list: async () => [...rows],
      create: async (name: string) => {
        if (rows.some((r) => r.name === name)) {
          throw { response: { data: { message: 'Category already exists' } } };
        }
        const row = { _id: String(rows.length), name };
        rows.push(row);
        created.push(name);
        return row;
      },
    },
  };
}

describe('ensureStoreCategory', () => {
  it('reuses an existing category regardless of case and creates nothing', async () => {
    const store = fakeStore(['Audio', 'Bags and Travel']);
    expect(await ensureStoreCategory('bags and travel', ['Audio'], store.io)).toBe('Bags and Travel');
    expect(store.created).toEqual([]);
  });

  it('creates only the new category when the table already has entries', async () => {
    const store = fakeStore(['Audio']);
    expect(await ensureStoreCategory('Mobiles & Tablets', ['Audio'], store.io)).toBe('Mobiles & Tablets');
    expect(store.created).toEqual(['Mobiles & Tablets']);
  });

  it('keeps the shop’s built-in categories when the table was empty', async () => {
    const store = fakeStore([]);
    await ensureStoreCategory('Cameras', ['Laptops', 'Phones'], store.io);
    expect(store.created).toEqual(['Laptops', 'Phones', 'Cameras']);
  });

  it('does not create the wanted category twice when it is also a built-in name', async () => {
    const store = fakeStore([]);
    await ensureStoreCategory('Laptops', ['Laptops', 'Phones'], store.io);
    expect(store.created).toEqual(['Phones', 'Laptops']);
  });

  it('treats "already exists" from a parallel publish as success', async () => {
    const racing = {
      list: async () => [],
      create: async () => {
        throw { response: { data: { message: 'Category already exists' } } };
      },
    };
    expect(await ensureStoreCategory('Fashion', [], racing)).toBe('Fashion');
  });

  it('passes other errors through', async () => {
    const broken = {
      list: async () => [],
      create: async () => {
        throw new Error('network down');
      },
    };
    await expect(ensureStoreCategory('Fashion', [], broken)).rejects.toThrow('network down');
  });
});
