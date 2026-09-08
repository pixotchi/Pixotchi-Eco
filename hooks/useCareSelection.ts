'use client';

import { useRef, useState } from 'react';
import { careItemRevision, findCareItem, type CareSelection } from '@/lib/care-catalog';
import { useItemCatalogs } from './useItemCatalogs';

export function useCareSelection() {
  const catalogs = useItemCatalogs();
  const [selection, setSelection] = useState<(CareSelection & { reviewedRevision: string }) | null>(null);
  const currentSelection = useRef(selection);
  currentSelection.current = selection;
  const itemType = selection?.itemType ?? 'garden';
  const item = findCareItem(selection, catalogs.gardenItems, catalogs.shopItems);
  const status = itemType === 'garden' ? catalogs.gardenStatus : catalogs.shopStatus;
  const changed = item !== null && selection?.reviewedRevision !== careItemRevision(item, itemType);
  const requireCurrent = async () => {
    if (!item || !selection || changed || status !== 'ready') throw new Error('Review the current care item before buying.');
    const result = await catalogs.refreshItemType(itemType);
    if (currentSelection.current !== selection) throw new Error('The care selection changed. Review it before buying.');
    const fresh = result.data?.find(candidate => candidate.id === selection.id);
    if (result.isError || !fresh) throw new Error('This care item could not be verified. Retry the catalog before buying.');
    if (careItemRevision(fresh, itemType) !== selection.reviewedRevision) throw new Error('This care item changed. Review the updated price and effects before buying.');
  };
  return { catalogs, selection, setSelection, itemType, item, status, changed, requireCurrent };
}
