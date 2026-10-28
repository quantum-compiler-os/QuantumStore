import { useQuery } from '@tanstack/react-query';
import api from '../api/client';
import type { Order } from '../api/types';
import { queryKeys } from './queryKeys';

export type AdminOrdersParams = {
  status?: string;
  search?: string;
  page?: number;
  limit?: number;
};

export type AdminOrdersResponse = {
  items: Order[];
  page: number;
  pages: number;
  total?: number;
};

export type OrderStats = {
  totalOrders: number;
  revenue: number;
  aov?: number;
  paidOrders: number;
  byDay: Array<{ day: string; revenue: number; orders?: number; newCustomers?: number }>;
  lowStock: Array<{ _id: string; name: string; stock: number }>;
  statusCounts: Record<string, number>;
  thisWeekRevenue: number;
  lastWeekRevenue: number;
  topSelling: Array<{ productId: string; name: string; units: number; revenue: number }>;
  byCategory: Array<{ category: string; revenue: number }>;
  newCustomers?: number;
  uniqueCustomers?: number;
  repeatCustomers?: number;
  repeatCustomerRate?: number;
  couponUsage?: Array<{ code: string; orders: number; discount: number }>;
};

export function useAdminOrders(params: AdminOrdersParams, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.orders.admin(params),
    queryFn: async () => {
      const { data } = await api.get<AdminOrdersResponse | Order[]>('/orders', { params });
      if (Array.isArray(data)) {
        return { items: data, page: 1, pages: 1 } satisfies AdminOrdersResponse;
      }
      return {
        items: data.items || [],
        page: data.page || params.page || 1,
        pages: data.pages || 1,
        total: data.total,
      };
    },
    enabled: options?.enabled ?? true,
  });
}

export function useOrderStats(params?: { from?: string; to?: string }, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.orders.stats(params),
    queryFn: async () => {
      const { data } = await api.get<OrderStats>('/orders/stats', { params });
      return data;
    },
    enabled: options?.enabled ?? true,
  });
}
