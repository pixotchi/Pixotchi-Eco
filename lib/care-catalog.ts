import type { GardenItem, ShopItem } from './types';

export type CareItemType = 'garden' | 'shop';
export type CareItem = GardenItem | ShopItem;
export type CareSelection = { itemType: CareItemType; id: string };
export type CareResourceStatus = 'loading' | 'ready' | 'error';

/** Normalize contract-era names once, at the catalog boundary. Explicit
 * capabilities take precedence, so new items need no presentation heuristics. */
export function getCareCapabilities(item: CareItem, type: CareItemType) {
  const declared = item.category;
  const isFence = type === 'shop' && (declared === 'fence-v2'
    || (!declared && /fence|shield/i.test(item.name)));
  const points = type === 'garden' ? Number((item as GardenItem).points) : 0;
  const lifetime = type === 'garden' ? Number((item as GardenItem).timeExtension) : 0;
  return {
    purchase: isFence ? 'fence-v2' as const : type,
    points,
    lifetime,
    group: isFence ? 'Protection'
      : points > 0 && lifetime > 0 ? 'Points and lifetime'
      : lifetime > 0 ? 'Add lifetime'
      : points > 0 ? 'Increase points'
      : 'More care items',
  };
}

export function findCareItem(selection: CareSelection | null, garden: GardenItem[], shop: ShopItem[]) {
  if (!selection) return null;
  return (selection.itemType === 'garden' ? garden : shop).find(item => item.id === selection.id) ?? null;
}

/** Only fields that change the reviewed purchase. Bigints remain exact. */
export function careItemRevision(item: CareItem, type: CareItemType) {
  const capability = getCareCapabilities(item, type);
  return JSON.stringify([type, item.id, item.name, String(item.price), capability.purchase,
    capability.points, capability.lifetime, 'effectTime' in item ? String(item.effectTime) : null]);
}
