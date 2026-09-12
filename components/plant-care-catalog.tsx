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
import { ResourceValue } from "./ui/resource-value";
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
  const gridClassName = "grid grid-cols-4 gap-1.5 @max-[12rem]/care:grid-cols-2 sm:grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))] sm:gap-2";
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
            className={gridClassName}
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
            <div className={gridClassName}>
              {group.items.map((option) => {
                const { item } = option;
                const selected =
                  selectedItem?.id === item.id && itemType === option.itemType;
                const isFence =
                  getCareCapabilities(item, option.itemType).purchase ===
                  "fence-v2";
                const points = "points" in item ? Number(item.points) / 1e12 : 0;
                const lifetime = "timeExtension" in item ? Number(item.timeExtension) : 0;
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
                      "h-auto min-h-20 min-w-0 w-full flex-col items-center justify-start gap-1 whitespace-normal rounded-[var(--radius-control)] border px-0.5 py-2 text-center [overflow-wrap:anywhere] sm:gap-1.5 sm:px-2 sm:py-3",
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
                      className="h-6 w-6 shrink-0 [image-rendering:pixelated] sm:h-8 sm:w-8"
                    />
                    <span className="flex min-h-8 items-center text-xs font-medium leading-4 tracking-tight sm:min-h-0 sm:tracking-normal">
                      {item.name}
                    </span>
                    <span className="flex max-w-full flex-col items-center text-xs font-medium leading-4 tabular-nums text-foreground sm:leading-relaxed">
                      {"points" in item ? <>
                        {points > 0 && <ResourceValue resource="points" className="flex-row-reverse gap-0.5">
                          +{formatNumber(points)}<span className="sr-only"> PTS</span>
                        </ResourceValue>}
                        {lifetime > 0 && <ResourceValue resource="lifetime" className="flex-row-reverse gap-0.5">
                          +{formatDuration(lifetime)}<span className="sr-only"> lifetime</span>
                        </ResourceValue>}
                      </> : <span>{isFence ? "Attack protection" : "Review item effect"}</span>}
                    </span>
                    <span className="mt-auto max-w-full text-xs font-normal leading-4 tabular-nums text-muted-foreground sm:leading-relaxed">
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
