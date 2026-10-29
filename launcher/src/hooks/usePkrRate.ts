import { DEFAULT_PKR_RATE, pkrRateFrom } from '../features/products/pricing';
import { useSettings } from './useSettings';

/** The store's PKR rate; `ready` is false until the settings have loaded (or failed), so prices are not saved with a guess. */
export function usePkrRate() {
  const { data, isPending } = useSettings();
  return { rate: pkrRateFrom(data?.currencies) ?? DEFAULT_PKR_RATE, ready: !isPending };
}
