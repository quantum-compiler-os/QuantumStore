/** Where a product is sold. Everything in the list is on QuantumStore, so the choice is whether Daraz has it too. */
export type Channel = 'all' | 'daraz' | 'store';
export type StockFilter = 'all' | 'in' | 'out';

export function matchesChannel(productId: string, channel: Channel, listedIds: ReadonlySet<string>) {
  if (channel === 'all') return true;
  return listedIds.has(productId) === (channel === 'daraz');
}

/** The same rule as the backend's `inStock` filter: blank stock is untracked, which counts as in stock. */
export function matchesStock(stock: number | null | undefined, filter: StockFilter) {
  if (filter === 'all') return true;
  const inStock = stock === null || stock === undefined || stock > 0;
  return inStock === (filter === 'in');
}

/** How many products each stock chip and each channel chip would show, given the other row's current choice. */
export function chipCounts(
  products: Array<{ _id: string; stock?: number | null }>,
  listedIds: ReadonlySet<string>,
  { channel, stock }: { channel: Channel; stock: StockFilter },
) {
  const count = (test: (product: { _id: string; stock?: number | null }) => boolean) => products.filter(test).length;
  const inChannel = (p: { _id: string }, c: Channel) => matchesChannel(p._id, c, listedIds);
  const inStock = (p: { stock?: number | null }, s: StockFilter) => matchesStock(p.stock, s);
  return {
    stock: {
      all: count((p) => inChannel(p, channel)),
      in: count((p) => inChannel(p, channel) && inStock(p, 'in')),
      out: count((p) => inChannel(p, channel) && inStock(p, 'out')),
    },
    channel: {
      all: count((p) => inStock(p, stock)),
      daraz: count((p) => inStock(p, stock) && inChannel(p, 'daraz')),
      store: count((p) => inStock(p, stock) && inChannel(p, 'store')),
    },
  };
}
