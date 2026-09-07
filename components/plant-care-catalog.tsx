"use client";

import Image from 'next/image';
import { Button } from './ui/button';
import type { GardenItem, ShopItem } from '@/lib/types';
import { ITEM_ICONS } from '@/lib/constants';
import { cn, formatDuration, formatNumber, formatTokenAmount } from '@/lib/utils';

type CareItem = { item: GardenItem | ShopItem; itemType: 'garden' | 'shop' };
interface PlantCareCatalogProps {
  gardenItems: GardenItem[];
  shopItems: ShopItem[];
  selectedItem: GardenItem | ShopItem | null;
  itemType: 'garden' | 'shop';
  onSelect: (option: CareItem) => void;
}

export function PlantCareCatalog({ gardenItems, shopItems, selectedItem, itemType, onSelect }: PlantCareCatalogProps) {
  const garden = (predicate: (item: GardenItem) => boolean): CareItem[] => gardenItems
    .filter(predicate)
    .sort((left, right) => left.price < right.price ? -1 : left.price > right.price ? 1 : 0)
    .map(item => ({ item, itemType: 'garden' }));
  const groups: { label: string; items: CareItem[] }[] = [
    { label: 'Add lifetime', items: garden(item => Number(item.timeExtension) > 0 && Number(item.points) === 0) },
    { label: 'Increase points', items: garden(item => Number(item.points) > 0 && Number(item.timeExtension) === 0) },
    { label: 'Points and lifetime', items: garden(item => Number(item.points) > 0 && Number(item.timeExtension) > 0) },
    { label: 'Protection', items: shopItems.filter(item => /fence|shield/i.test(item.name)).map(item => ({ item, itemType: 'shop' })) },
  ];
  return <div className="@container/care space-y-3">
    {groups.filter(group => group.items.length).map(group => <section key={group.label} className="space-y-1.5" aria-label={group.label}>
      <h4 className="text-xs font-medium text-muted-foreground">{group.label}</h4>
      <div className="grid grid-cols-2 @min-[340px]/care:grid-cols-4 gap-2">
        {group.items.map(option => {
          const { item } = option;
          const selected = selectedItem?.id === item.id && itemType === option.itemType;
          const isFence = /fence|shield/i.test(item.name);
          const effects = 'points' in item
            ? [
              Number(item.points) > 0 && `+${formatNumber(Number(item.points) / 1e12)} PTS`,
              Number(item.timeExtension) > 0 && `+${formatDuration(Number(item.timeExtension))} TOD`,
            ].filter((effect): effect is string => typeof effect === 'string')
            : ['Attack protection'];
          return <Button key={`${option.itemType}-${item.id}`} type="button" variant="ghost" onClick={() => onSelect(option)} aria-pressed={selected} aria-haspopup="dialog"
              aria-label={`Select ${item.name}`} className={cn('h-auto min-h-20 min-w-0 w-full flex-col items-center gap-1 whitespace-normal rounded-[var(--radius-control)] border px-1 py-1.5 text-center', selected ? 'border-primary bg-primary/10' : 'border-border/60 bg-card')}>
              <Image src={ITEM_ICONS[item.name.toLowerCase()] || '/icons/BEE.png'} alt="" width={32} height={32} className="shrink-0 [image-rendering:pixelated]" />
              <span className="text-xs font-medium leading-4">{item.name}</span>
              <span className="flex flex-col items-center text-[10px] font-bold leading-3 tabular-nums text-muted-foreground">
                {effects.map(effect => <span key={effect} className="whitespace-nowrap">{effect}</span>)}
              </span>
              <span className="text-[10px] font-normal leading-3 tabular-nums text-muted-foreground">{isFence ? 'By duration' : `${formatTokenAmount(BigInt(item.price))} SEED`}</span>
            </Button>;
        })}
      </div>
    </section>)}
  </div>;
}
