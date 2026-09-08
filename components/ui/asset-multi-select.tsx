"use client";

import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from './button';
import { Input } from './input';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './dropdown-menu';

export function AssetMultiSelect<T extends string | number>({ label, assetLabel, items, selectedIds, onChange }: {
  label: string; assetLabel: string; items: readonly { id: T; name?: string | null }[];
  selectedIds: readonly T[]; onChange: (ids: T[]) => void;
}) {
  const labelId = useId();
  const valueId = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const keyboardOpening = useRef(false);
  useEffect(() => {
    if (!open || !keyboardOpening.current) return;
    const frame = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);
  const selected = new Set(selectedIds);
  const currentIds = items.filter(item => selected.has(item.id)).map(item => item.id);
  const filter = query.trim().toLocaleLowerCase();
  const visibleItems = items.filter(item => !filter || `${item.name ?? ''} ${assetLabel} #${item.id}`.toLocaleLowerCase().includes(filter));
  const allVisibleSelected = visibleItems.length > 0 && visibleItems.every(item => selected.has(item.id));
  return <div className="min-w-0 space-y-2 text-sm">
    <div className="flex items-baseline justify-between gap-2"><span id={labelId}>{label}</span><span className="text-xs tabular-nums text-muted-foreground">{currentIds.length}/{items.length}</span></div>
    <DropdownMenu modal={false} open={open} onOpenChange={value => { setOpen(value); if (!value) setQuery(''); }}>
      <DropdownMenuTrigger asChild><Button type="button" variant="outline" aria-labelledby={`${labelId} ${valueId}`} className="min-h-11 w-full justify-between gap-2 whitespace-normal text-left"
        onPointerDown={() => { keyboardOpening.current = false; }}
        onKeyDown={event => { if (['Enter', ' ', 'ArrowDown'].includes(event.key)) keyboardOpening.current = true; }}>
        <span id={valueId}>{currentIds.length} selected</span><ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
      </Button></DropdownMenuTrigger>
      <DropdownMenuContent matchTriggerWidth className="z-[var(--z-modal-nested)] [--menu-max-height:15rem] overflow-y-auto overscroll-contain"
        onKeyDownCapture={event => {
          if (!searchRef.current) return;
          const firstResult = event.currentTarget.querySelector<HTMLElement>('[role="menuitemcheckbox"]');
          if (event.key === 'Tab') {
            event.preventDefault(); event.stopPropagation();
            if (event.target === searchRef.current) (firstResult ?? event.currentTarget.querySelector<HTMLElement>('[role="menuitem"]:not([data-disabled])'))?.focus();
            else searchRef.current.focus();
          } else if (event.key === 'ArrowUp' && event.target === firstResult) {
            event.preventDefault(); event.stopPropagation(); searchRef.current.focus();
          }
        }}>
        {items.length > 12 && <div className="p-1">
          <Input ref={searchRef} aria-label={`Search ${assetLabel.toLowerCase()} names or IDs`} placeholder="Search name or ID" value={query} onChange={event => setQuery(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Escape' || event.key === 'Tab') return;
              // Keep typing and caret movement in the field, outside menu typeahead.
              event.stopPropagation();
              if (event.key === 'Enter') event.preventDefault();
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                event.currentTarget.closest('[role="menu"]')?.querySelector<HTMLElement>('[role="menuitemcheckbox"]')?.focus();
              }
            }} />
        </div>}
        <div className="grid grid-cols-2 gap-1 p-1">
          <DropdownMenuItem className="justify-center" disabled={allVisibleSelected || !visibleItems.length} onSelect={event => { event.preventDefault(); onChange([...new Set([...currentIds, ...visibleItems.map(item => item.id)])]); }}>{filter ? 'Select matches' : 'Select all'}</DropdownMenuItem>
          <DropdownMenuItem className="justify-center" disabled={!currentIds.length} onSelect={event => { event.preventDefault(); onChange([]); }}>Clear</DropdownMenuItem>
        </div>
        <DropdownMenuSeparator />
        {!visibleItems.length && <p role="status" className="px-3 py-2 text-sm text-muted-foreground">No matching {assetLabel.toLowerCase()}s.</p>}
        {visibleItems.map(item => <DropdownMenuCheckboxItem key={item.id} checked={selected.has(item.id)} onSelect={event => event.preventDefault()}
          onCheckedChange={checked => onChange(checked === true ? [...currentIds.filter(id => id !== item.id), item.id] : currentIds.filter(id => id !== item.id))}>
          <span className="min-w-0 flex-1 break-words">{item.name || `${assetLabel} #${item.id}`}</span>
          {item.name && <span className="ml-2 shrink-0 text-xs text-muted-foreground">#{item.id}</span>}
        </DropdownMenuCheckboxItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
  </div>;
}
