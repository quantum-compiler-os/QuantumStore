import { audionicCollection, listingCollection } from './db.js';
import { getAccessToken, getCategoryLeaves, listDarazProducts, removeProduct } from './daraz.js';
import { publishListing, type PublishBody } from './darazPublish.js';
import { prepareListing } from './prepareListing.js';
import { storeClient } from './storeApi.js';
import type { SyncDeps } from './syncRun.js';

/** The real QuantumStore, Daraz and database behind the sync, acting with the owner's bearer token. */
export function realSyncDeps(authorization: string, log: (text: string) => void): SyncDeps {
  return {
    store: storeClient(authorization),
    daraz: {
      items: async () => listDarazProducts(await getAccessToken()),
      leaves: getCategoryLeaves,
      removeItem: async (item) =>
        removeProduct({ darazItemId: item.itemId, skuId: item.skuId, sellerSku: item.sellerSku }, await getAccessToken()),
      prepare: async (input) => {
        const prepared = await prepareListing({ ...input, specs: [], categoryId: null, attributes: {} });
        return { ...prepared, category: prepared.category ? { id: prepared.category.id, path: prepared.category.path } : null };
      },
      publish: (request) => publishListing(request as unknown as PublishBody),
    },
    listings: {
      all: async () => {
        const rows = await (await listingCollection()).find({}).toArray();
        return rows.map((row) => ({
          quantumProductId: row.quantumProductId,
          darazItemId: row.darazItemId,
          sellerSku: row.sellerSku,
          skuId: row.skuId,
          categoryId: row.categoryId,
        }));
      },
      save: async (listing) => {
        await (await listingCollection()).updateOne(
          { darazItemId: listing.darazItemId },
          { $set: { ...listing }, $setOnInsert: { createdAt: new Date() } },
          { upsert: true },
        );
      },
      removeByItem: async (darazItemId) => {
        await (await listingCollection()).deleteMany({ darazItemId });
      },
    },
    managedProductIds: async () => {
      const rows = await (await audionicCollection()).find({}, { projection: { quantumProductId: 1 } }).toArray();
      return rows.map((row) => row.quantumProductId).filter(Boolean);
    },
    log,
  };
}
