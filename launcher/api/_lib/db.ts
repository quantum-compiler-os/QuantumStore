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

/**
 * One price change made by `npm run raise-prices`, saved just before the change. `_id` is `<runId>:<target>:<key>`, so
 * a re-run of the same run finds it and never adds the amount twice (see api/_lib/priceRaise.ts).
 */
export type PriceRaiseRecord = {
  _id: string;
  runId: string;
  target: 'store' | 'daraz';
  /** QuantumStore product id, or Daraz SKU id. */
  key: string;
  name: string;
  from: unknown;
  to: unknown;
  at: Date;
};

export async function priceRaiseCollection() {
  return (await getDb()).collection<PriceRaiseRecord>('launcher_price_raises');
}

/** Remembers which Audionic product became which QuantumStore product (and Daraz item), so a re-sync never duplicates. */
export type AudionicLink = {
  audionicId: string;
  quantumProductId: string;
  /** Null while the item is only on QuantumStore (Daraz not connected, sold out, or Daraz refused it). */
  darazItemId: string | null;
  sellerSku: string;
  /** Audionic's price (rupees) and availability when last synced, to tell what has changed since. */
  sourcePkr: number;
  available: boolean;
  syncedAt: Date;
};

export async function audionicCollection() {
  return (await getDb()).collection<AudionicLink>('launcher_audionic');
}

/** The same for CamSham products (camsham.pk), keyed by CamSham's product id. */
export type CamshamLink = Omit<AudionicLink, 'audionicId'> & { camshamId: string };

export async function camshamCollection() {
  return (await getDb()).collection<CamshamLink>('launcher_camsham');
}
