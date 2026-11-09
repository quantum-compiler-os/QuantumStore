import { useMemo, useState, type FormEvent } from 'react';
import type { StoreInfo } from '../../api/stores';
import { storeConfig } from '../../features/stores/storeConfig';
import { MARKUP_PKR, PLATFORM_NAME, recentStores, rememberStore, shopHost } from '../../features/stores/storeFetcher';
import SupplierSyncPage from '../../features/suppliers/SupplierSyncPage';

export default function StoreFetcher() {
  const [draft, setDraft] = useState('');
  const [address, setAddress] = useState('');
  const [recent, setRecent] = useState(recentStores);
  const [info, setInfo] = useState<StoreInfo | null>(null);
  const [error, setError] = useState('');
  const host = shopHost(address);
  const config = useMemo(() => (host ? storeConfig(address, host, setInfo) : null), [address, host]);

  function open(next: string) {
    const name = shopHost(next);
    if (!name || !name.includes('.')) {
      setError('Type a shop address, e.g. example.pk');
      return;
    }
    setError('');
    setInfo(null);
    setDraft(next.trim());
    setAddress(next.trim());
    setRecent(rememberStore(next.trim()));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    open(draft);
  }

  return (
    <div>
      {!config && (
        <>
          <h1>Store fetcher</h1>
          <p className="muted">
            Type the address of any Shopify or WooCommerce shop that prices in rupees. Its products are read, priced at the
            shop&apos;s price + Rs {MARKUP_PKR} for QuantumStore, and listed on Daraz at that price plus Daraz&apos;s
            commission.
          </p>
        </>
      )}

      <form className="admin-quick" onSubmit={handleSubmit} style={{ alignItems: 'flex-end', margin: '0 0 1rem' }}>
        <label style={{ display: 'grid', gap: '0.25rem', flex: '1 1 18rem', maxWidth: '28rem' }}>
          Shop address
          <input
            className="input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="example.pk"
            autoComplete="off"
            spellCheck={false}
            inputMode="url"
          />
        </label>
        {/* Reading the same shop again is the "Refresh from …" button below. */}
        <button type="submit" className="btn btn-primary" disabled={Boolean(config) && shopHost(draft) === host}>
          Fetch products
        </button>
      </form>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {recent.length > 0 && (
        <div className="admin-quick" style={{ margin: '0 0 1rem', alignItems: 'center' }}>
          <span className="muted">Recent:</span>
          {recent.map((shop) => (
            <button key={shop} type="button" className="btn btn-ghost" disabled={shopHost(shop) === host} onClick={() => open(shop)}>
              {shopHost(shop)}
            </button>
          ))}
        </div>
      )}
      {info && (
        <p className="muted" style={{ margin: '0 0 1rem' }}>
          {info.host}: {PLATFORM_NAME[info.platform]} shop · prices in {info.currency ?? 'PKR (the shop does not say; taken as rupees)'}
        </p>
      )}

      {config && <SupplierSyncPage key={host} config={config} />}
    </div>
  );
}
