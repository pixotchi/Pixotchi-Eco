"use client";

import Image from 'next/image';
import { Button } from './ui/button';
import type { GardenItem, ShopItem } from '@/lib/types';
import { ITEM_ICONS } from '@/lib/constants';
import { cn, formatDuration, formatTokenAmount } from '@/lib/utils';

type CareItem = { item: GardenItem | ShopItem; itemType: 'garden' | 'shop' };
interface PlantCareCatalogProps {
  gardenItems: GardenItem[];
  shopItems: ShopItem[];
  selectedItem: GardenItem | ShopItem | null;
  itemType: 'garden' | 'shop';
  onSelect: (option: CareItem) => void;
}

export function PlantCareCatalog({ gardenItems, shopItems, selectedItem, itemType, onSelect }: PlantCareCatalogProps) {
  const garden = (predicate: (item: GardenItem) => boolean): CareItem[] => gardenItems.filter(predicate).map(item => ({ item, itemType: 'garden' }));
  const groups: { label: string; items: CareItem[] }[] = [
    { label: 'Add lifetime', items: garden(item => Number(item.timeExtension) > 0 && Number(item.points) === 0) },
    { label: 'Increase points', items: garden(item => Number(item.points) > 0 && Number(item.timeExtension) === 0) },
    { label: 'Points and lifetime', items: garden(item => Number(item.points) > 0 && Number(item.timeExtension) > 0) },
    { label: 'Protection', items: shopItems.filter(item => /fence|shield/i.test(item.name)).map(item => ({ item, itemType: 'shop' })) },
  ];
  return <div className="space-y-3">
    {groups.filter(group => group.items.length).map(group => <section key={group.label} className="space-y-1.5" aria-label={group.label}>
      <h4 className="text-xs font-medium text-muted-foreground">{group.label}</h4>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,4.5rem),1fr))] gap-2">
        {group.items.map(option => {
          const { item } = option;
          const selected = selectedItem?.id === item.id && itemType === option.itemType;
          const isFence = /fence|shield/i.test(item.name);
          const effect = 'points' in item
            ? [
              Number(item.points) > 0 && `+${Number(item.points) / 1e12} PTS`,
              Number(item.timeExtension) > 0 && `+${formatDuration(Number(item.timeExtension))} lifetime`,
            ].filter(Boolean).join(' · ')
            : 'Attack protection';
          return <Button key={`${option.itemType}-${item.id}`} type="button" variant="ghost" onClick={() => onSelect(option)} aria-pressed={selected} aria-haspopup="dialog"
              aria-label={`Select ${item.name}`} className={cn('h-auto min-h-20 min-w-0 w-full flex-col items-center gap-1 whitespace-normal rounded-[var(--radius-control)] border px-1 py-1.5 text-center', selected ? 'border-primary bg-primary/10' : 'border-border/60 bg-card')}>
              <Image src={ITEM_ICONS[item.name.toLowerCase()] || '/icons/BEE.png'} alt="" width={32} height={32} className="shrink-0" />
              <span className="text-xs font-medium leading-4">{item.name}</span>
              <span className="text-[10px] font-bold leading-3 tabular-nums text-muted-foreground">{effect}</span>
              <span className="text-[10px] font-normal leading-3 tabular-nums text-muted-foreground">{isFence ? 'By duration' : `${formatTokenAmount(BigInt(item.price))} SEED`}</span>
            </Button>;
        })}
      </div>
    </section>)}
  </div>;
}
