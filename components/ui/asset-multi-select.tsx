"use client";

import { useId } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from './button';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './dropdown-menu';

export function AssetMultiSelect<T extends string | number>({ label, assetLabel, items, selectedIds, onChange }: {
  label: string; assetLabel: string; items: readonly { id: T; name?: string | null }[];
  selectedIds: readonly T[]; onChange: (ids: T[]) => void;
}) {
  const labelId = useId();
  const valueId = useId();
  const selected = new Set(selectedIds);
  const currentIds = items.filter(item => selected.has(item.id)).map(item => item.id);
  const allSelected = items.length > 0 && currentIds.length === items.length;
  return <div className="min-w-0 space-y-2 text-sm">
    <div className="flex items-baseline justify-between gap-2"><span id={labelId}>{label}</span><span className="text-xs tabular-nums text-muted-foreground">{currentIds.length}/{items.length}</span></div>
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild><Button type="button" variant="outline" aria-labelledby={`${labelId} ${valueId}`} className="min-h-11 w-full justify-between gap-2 whitespace-normal text-left">
        <span id={valueId}>{currentIds.length} selected</span><ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
      </Button></DropdownMenuTrigger>
      <DropdownMenuContent matchTriggerWidth className="z-[var(--z-modal-nested)] max-h-60 overflow-y-auto overscroll-contain">
        <div className="grid grid-cols-2 gap-1 p-1">
          <DropdownMenuItem className="justify-center" disabled={allSelected || !items.length} onSelect={event => { event.preventDefault(); onChange(items.map(item => item.id)); }}>Select all</DropdownMenuItem>
          <DropdownMenuItem className="justify-center" disabled={!currentIds.length} onSelect={event => { event.preventDefault(); onChange([]); }}>Clear</DropdownMenuItem>
        </div>
        <DropdownMenuSeparator />
        {items.map(item => <DropdownMenuCheckboxItem key={item.id} checked={selected.has(item.id)} onSelect={event => event.preventDefault()}
          onCheckedChange={checked => onChange(checked === true ? [...currentIds.filter(id => id !== item.id), item.id] : currentIds.filter(id => id !== item.id))}>
          <span className="min-w-0 flex-1 break-words">{item.name || `${assetLabel} #${item.id}`}</span>
          {item.name && <span className="ml-2 shrink-0 text-xs text-muted-foreground">#{item.id}</span>}
        </DropdownMenuCheckboxItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
  </div>;
}
