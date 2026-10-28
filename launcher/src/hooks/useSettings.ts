import { useQuery } from '@tanstack/react-query';
import { getSettings } from '../api/settings';
import type { StoreSettings } from '../api/types';
import { queryKeys } from './queryKeys';

export function useSettings(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: async () => {
      const data = await getSettings();
      return data as StoreSettings;
    },
    enabled: options?.enabled ?? true,
  });
}
