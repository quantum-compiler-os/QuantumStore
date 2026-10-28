import { MongoClient, type Db } from 'mongodb';

export type DarazConnection = {
  _id: 'connection';
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  refreshExpiresAt: Date | null;
  account: string;
  country: string;
  sellerId: string;
  connectedAt: Date;
};

export type Listing = {
  quantumProductId: string;
  darazItemId: string;
  sellerSku: string;
  skuId: string;
  categoryId: number;
  createdAt: Date;
};

let clientPromise: Promise<MongoClient> | null = null;

/** Reused across warm serverless invocations (and Vite dev reloads). */
export async function getDb(): Promise<Db> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not configured for the launcher');
  clientPromise ??= new MongoClient(uri).connect();
  const client = await clientPromise;
  return client.db();
}

export async function connectionCollection() {
  return (await getDb()).collection<DarazConnection>('launcher_daraz');
}

export async function listingCollection() {
  return (await getDb()).collection<Listing>('launcher_listings');
}
