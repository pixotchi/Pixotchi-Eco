"use client";

import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { Plant } from '@/lib/types';
import PlantImage from '@/components/PlantImage';
import CountdownTimer from '@/components/countdown-timer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

const PAGE_SIZE = 50;

function PlantOption({ plant }: { plant: Plant }) {
  return <span className="flex min-w-0 flex-1 items-center gap-2 text-left">
    <PlantImage selectedPlant={plant} width={28} height={28} />
    <span className="min-w-0 flex-1">
      <span className="block truncate font-medium">{plant.name || `Plant #${plant.id}`}</span>
      {plant.name && <span className="block text-xs text-muted-foreground">#{plant.id}</span>}
    </span>
    <span className="shrink-0"><CountdownTimer timeUntilStarving={plant.timeUntilStarving} noBackground showSeconds={false} className="text-xs" /></span>
  </span>;
}

/** A single resource destination, with the same labeled/selected menu behavior as other asset pickers. */
export function PlantResourcePicker({ plants, selectedId, onChange, disabled }: {
  plants: readonly Plant[]; selectedId: number | null; onChange: (id: number) => void; disabled?: boolean;
}) {
  const labelId = useId();
  const valueId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const searchRef = useRef<HTMLInputElement>(null);
  const keyboardOpening = useRef(false);
  const selected = plants.find(plant => plant.id === selectedId);
  const search = query.trim().toLocaleLowerCase();
  const matches = plants.filter(plant => !search || `${plant.name ?? ''} Plant #${plant.id}`.toLocaleLowerCase().includes(search));
  const visible = matches.slice(0, limit);
  useEffect(() => {
    if (!disabled) return;
    setOpen(false);
    setQuery('');
    setLimit(PAGE_SIZE);
  }, [disabled]);
  useEffect(() => {
    if (!open || !keyboardOpening.current) return;
    const frame = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);
  return <div className="min-w-0 space-y-2 text-sm">
    <div className="flex items-baseline justify-between gap-2">
      <span id={labelId} className="font-medium">Plant to receive resources</span>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{plants.length} plants</span>
    </div>
    <DropdownMenu open={open} onOpenChange={value => { setOpen(value); if (!value) { setQuery(''); setLimit(PAGE_SIZE); } }}>
      {/* A width-matched menu needs an unscaled anchor during pointer-down measurement. */}
      <DropdownMenuTrigger asChild><Button type="button" variant="outline" disabled={disabled || !plants.length}
        aria-labelledby={`${labelId} ${valueId}`} title={selected ? `${selected.name || 'Plant'} #${selected.id}` : undefined} className="h-16 w-full min-w-0 active:scale-100 justify-between gap-2 text-sm"
        onPointerDown={() => { keyboardOpening.current = false; }}
        onKeyDown={event => { if (['Enter', ' ', 'ArrowDown'].includes(event.key)) keyboardOpening.current = true; }}>
        <span id={valueId} className="flex min-w-0 flex-1">{selected ? <PlantOption plant={selected} /> : 'Select a plant'}</span>
        <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
      </Button></DropdownMenuTrigger>
      <DropdownMenuContent matchTriggerWidth className="[--menu-max-height:22rem]"
        onKeyDownCapture={event => {
          if (!searchRef.current) return;
          const first = event.currentTarget.querySelector<HTMLElement>('[role="menuitemradio"]');
          if (event.key === 'Tab') {
            event.preventDefault(); event.stopPropagation();
            if (event.target === searchRef.current) first?.focus(); else searchRef.current.focus();
          } else if (event.key === 'ArrowUp' && event.target === first) {
            event.preventDefault(); event.stopPropagation(); searchRef.current.focus();
          }
        }}>
        {plants.length > 12 && <div className="sticky top-0 z-10 bg-popover p-1">
          <Input ref={searchRef} aria-label="Search plant names or IDs" placeholder="Search name or ID" value={query}
            onChange={event => { setQuery(event.target.value); setLimit(PAGE_SIZE); }}
            onKeyDown={event => {
              if (event.key === 'Escape' || event.key === 'Tab') return;
              event.stopPropagation();
              if (event.key === 'Enter') event.preventDefault();
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                event.currentTarget.closest('[role="menu"]')?.querySelector<HTMLElement>('[role="menuitemradio"]')?.focus();
              }
            }} />
        </div>}
        {!matches.length && <p role="status" className="px-3 py-2 text-sm text-muted-foreground">No matching plants.</p>}
        <DropdownMenuRadioGroup value={selectedId === null ? '' : String(selectedId)} onValueChange={value => onChange(Number(value))}>
          {visible.map(plant => <DropdownMenuRadioItem key={plant.id} value={String(plant.id)} textValue={`${plant.name ?? ''} Plant #${plant.id}`}
            className="h-16" title={`${plant.name || 'Plant'} #${plant.id}`}><PlantOption plant={plant} /></DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
        {visible.length < matches.length && <DropdownMenuItem className="justify-center" onSelect={event => { event.preventDefault(); setLimit(value => value + PAGE_SIZE); }}>
          Show more plants ({visible.length} of {matches.length})
        </DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  </div>;
}
