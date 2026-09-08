"use client";

import { useQuery } from "@tanstack/react-query";
import { getAllShopItems, getAllGardenItems } from "@/lib/contracts";
import type { CareResourceStatus, CareItemType } from '@/lib/care-catalog';

export function useItemCatalogs() {
  const options = {
    staleTime: 60_000,
    refetchInterval: 60_000, // Pick up onchain catalog additions while the garden is open.
    refetchOnWindowFocus: true,
    gcTime: 1000 * 60 * 60, // 1 hour
  };
  const garden = useQuery({ ...options, queryKey: ['item-catalogs', 'garden'], queryFn: () => getAllGardenItems() });
  const shop = useQuery({ ...options, queryKey: ['item-catalogs', 'shop'], queryFn: () => getAllShopItems() });
  const status = (query: { isError: boolean; data: unknown }): CareResourceStatus => query.isError ? 'error' : query.data === undefined ? 'loading' : 'ready';

  return {
    shopItems: shop.data ?? [],
    gardenItems: garden.data ?? [],
    shopStatus: status(shop),
    gardenStatus: status(garden),
    retryShop: () => shop.refetch(),
    retryGarden: () => garden.refetch(),
    refreshItemType: (type: CareItemType) => type === 'garden' ? garden.refetch() : shop.refetch(),
  };
}

