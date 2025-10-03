"use client";

import { useQuery } from "@tanstack/react-query";
import { getAllShopItems, getAllGardenItems } from "@/lib/contracts";
import type { ShopItem, GardenItem } from "@/lib/types";

type ItemCatalogs = {
  shopItems: ShopItem[];
  gardenItems: GardenItem[];
};

export function useItemCatalogs() {
  const query = useQuery<ItemCatalogs>({
    queryKey: ["item-catalogs"],
    staleTime: 1000 * 60 * 30, // 30 minutes
    gcTime: 1000 * 60 * 60, // 1 hour
    queryFn: async () => {
      const [shopItems, gardenItems] = await Promise.all([
        getAllShopItems(),
        getAllGardenItems(),
      ]);

      return { shopItems, gardenItems };
    },
  });

  return {
    ...query,
    shopItems: query.data?.shopItems ?? [],
    gardenItems: query.data?.gardenItems ?? [],
  };
}

