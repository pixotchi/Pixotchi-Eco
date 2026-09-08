"use client";

import Image from "next/image";
import { Button } from "./ui/button";
import type { GardenItem, ShopItem } from "@/lib/types";
import { ITEM_ICONS } from "@/lib/constants";
import {
  cn,
  formatDuration,
  formatNumber,
} from "@/lib/utils";
import {
  getCareCapabilities,
  type CareResourceStatus,
} from "@/lib/care-catalog";
import { ResourceState } from "./ui/resource-state";
import { Skeleton } from "./ui/skeleton";
import { TokenAmount } from "./ui/token-amount";

type CareItem = { item: GardenItem | ShopItem; itemType: "garden" | "shop" };
interface PlantCareCatalogProps {
  gardenItems: GardenItem[];
  shopItems: ShopItem[];
  selectedItem: GardenItem | ShopItem | null;
  itemType: "garden" | "shop";
  onSelect: (option: CareItem) => void;
  gardenStatus?: CareResourceStatus;
  shopStatus?: CareResourceStatus;
  onRetryGarden?: () => void;
  onRetryShop?: () => void;
}

export function PlantCareCatalog({
  gardenItems,
  shopItems,
  selectedItem,
  itemType,
  onSelect,
  gardenStatus = "ready",
  shopStatus = "ready",
  onRetryGarden,
  onRetryShop,
}: PlantCareCatalogProps) {
  const all: CareItem[] = [
    ...gardenItems.map((item) => ({ item, itemType: "garden" as const })),
    ...shopItems.map((item) => ({ item, itemType: "shop" as const })),
  ];
  const groups = [
    "Add lifetime",
    "Increase points",
    "Points and lifetime",
    "Protection",
    "More care items",
  ].map((label) => ({
    label,
    items: all
      .filter(
        (option) =>
          getCareCapabilities(option.item, option.itemType).group === label,
      )
      .sort((left, right) =>
        BigInt(left.item.price) < BigInt(right.item.price)
          ? -1
          : BigInt(left.item.price) > BigInt(right.item.price)
            ? 1
            : 0,
      ),
  }));
  return (
    <div className="@container/care space-y-3">
      {[
        { label: "Garden items", status: gardenStatus, retry: onRetryGarden },
        { label: "Shop items", status: shopStatus, retry: onRetryShop },
      ].map((resource) =>
        resource.status === "error" ? (
          <ResourceState
            key={resource.label}
            status="error"
            title={`${resource.label} unavailable`}
            description="We could not verify this catalog. Existing items may be outdated; retry before buying."
            onRetry={resource.retry}
          />
        ) : resource.status === "loading" ? (
          <div
            key={resource.label}
            role="status"
            aria-label={`Loading ${resource.label.toLowerCase()}`}
            className="grid grid-cols-2 gap-2"
          >
            {[0, 1, 2, 3].map((index) => (
              <Skeleton
                key={index}
                className="h-24 rounded-[var(--radius-control)]"
              />
            ))}
          </div>
        ) : null,
      )}
      {all.length === 0 &&
        gardenStatus === "ready" &&
        shopStatus === "ready" && (
          <ResourceState
            status="empty"
            title="No care items available"
            description="The catalog has no items right now. Check again later."
          />
        )}
      {groups
        .filter((group) => group.items.length)
        .map((group) => (
          <section
            key={group.label}
            className="space-y-1.5"
            aria-label={group.label}
          >
            <h4 className="text-xs font-medium text-muted-foreground">
              {group.label}
            </h4>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))] gap-2">
              {group.items.map((option) => {
                const { item } = option;
                const selected =
                  selectedItem?.id === item.id && itemType === option.itemType;
                const isFence =
                  getCareCapabilities(item, option.itemType).purchase ===
                  "fence-v2";
                const effects =
                  "points" in item
                    ? [
                        Number(item.points) > 0 &&
                          `+${formatNumber(Number(item.points) / 1e12)} PTS`,
                        Number(item.timeExtension) > 0 &&
                          `+${formatDuration(Number(item.timeExtension))} lifetime`,
                      ].filter(
                        (effect): effect is string =>
                          typeof effect === "string",
                      )
                    : isFence
                      ? ["Attack protection"]
                      : ["Review item effect"];
                return (
                  <Button
                    key={`${option.itemType}-${item.id}`}
                    type="button"
                    variant="ghost"
                    onClick={() => onSelect(option)}
                    aria-pressed={selected}
                    aria-haspopup="dialog"
                    aria-label={`Select ${item.name}`}
                    className={cn(
                      "h-auto min-h-20 min-w-0 w-full flex-col items-center gap-1.5 whitespace-normal rounded-[var(--radius-control)] border px-2 py-3 text-center [overflow-wrap:anywhere]",
                      selected
                        ? "border-primary bg-primary/10"
                        : "border-border/60 bg-card",
                    )}
                  >
                    <Image
                      src={
                        ITEM_ICONS[item.name.toLowerCase()] || "/icons/BEE.png"
                      }
                      alt=""
                      width={32}
                      height={32}
                      className="shrink-0 [image-rendering:pixelated]"
                    />
                    <span className="text-xs font-medium leading-4">
                      {item.name}
                    </span>
                    <span className="flex max-w-full flex-col items-center text-xs font-medium leading-relaxed tabular-nums text-foreground">
                      {effects.map((effect) => (
                        <span key={effect}>{effect}</span>
                      ))}
                    </span>
                    <span className="max-w-full text-xs font-normal leading-relaxed tabular-nums text-muted-foreground">
                      {isFence
                        ? "By duration"
                        : <TokenAmount amount={BigInt(item.price)} unit="SEED" mode="cost" withIcon={false} />}
                    </span>
                  </Button>
                );
              })}
            </div>
          </section>
        ))}
    </div>
  );
}
