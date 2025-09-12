"use client";

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useAccount } from 'wagmi';
import { getPlantsByOwner } from '@/lib/contracts';
import PlantImage from '@/components/PlantImage';
import { ChevronDown } from 'lucide-react';
import WarehouseApplyTransaction from '@/components/transactions/warehouse-apply-transaction';
import { toast } from 'react-hot-toast';

interface WarehousePanelProps {
  landId: bigint;
  warehousePoints?: bigint;
  warehouseLifetime?: bigint;
  onApplySuccess: () => void;
}

export default function WarehousePanel({
  landId,
  warehousePoints,
  warehouseLifetime,
  onApplySuccess
}: WarehousePanelProps) {
  const { address } = useAccount();
  const [plants, setPlants] = useState<{ id: number; name: string }[]>([]);
  const [selectedPlantId, setSelectedPlantId] = useState<number | null>(null);
  const [applyPts, setApplyPts] = useState<string>("");
  const [applyTodMinutes, setApplyTodMinutes] = useState<string>("");

  const loadPlants = useCallback(async () => {
    if (!address) return;
    try {
      const list = await getPlantsByOwner(address);
      const simplified = list.map(p => ({ id: p.id, name: p.name || `Plant #${p.id}` }));
      setPlants(simplified);
      if (!selectedPlantId && simplified.length > 0) {
        setSelectedPlantId(simplified[0].id);
      }
    } catch (e) {
      // Silently ignore
    }
  }, [address, selectedPlantId]);

  useEffect(() => {
    loadPlants();
  }, [loadPlants]);

  const availablePtsHuman = useMemo(() => {
    const v = typeof warehousePoints === 'bigint' ? warehousePoints : BigInt(0);
    const scale = BigInt(1_000_000_000_000); // 1e12
    const whole = v / scale;
    const frac = v % scale;
    const rem4 = (frac * BigInt(10_000)) / scale;
    let dec = rem4.toString().padStart(4, '0').replace(/0+$/, '');
    return dec.length > 0 ? `${whole.toString()}.${dec}` : whole.toString();
  }, [warehousePoints]);

  const availableMinutes = useMemo(() => {
    const v = typeof warehouseLifetime === 'bigint' ? warehouseLifetime : BigInt(0);
    return (v / BigInt(60)).toString();
  }, [warehouseLifetime]);

  const parsePtsToScaled = useCallback((value: string): bigint | null => {
    const trimmed = (value || '').trim();
    if (!trimmed || !/^\d*(?:\.\d+)?$/.test(trimmed)) return null;
    try {
      const [whole, dec = ''] = trimmed.split('.');
      const frac12 = (dec + '0'.repeat(12)).slice(0, 12);
      return BigInt((whole || '0') + frac12);
    } catch {
      return null;
    }
  }, []);

  const ptsParsedScaled = useMemo(() => parsePtsToScaled(applyPts), [applyPts, parsePtsToScaled]);
  const ptsTooHigh = useMemo(() => {
    if (ptsParsedScaled === null) return false;
    const cap = typeof warehousePoints === 'bigint' ? warehousePoints : BigInt(0);
    return ptsParsedScaled > cap;
  }, [ptsParsedScaled, warehousePoints]);

  const minutesParsed = useMemo(() => {
    const v = Math.floor(Number(applyTodMinutes || ''));
    return Number.isFinite(v) ? v : NaN;
  }, [applyTodMinutes]);
  const minutesTooHigh = useMemo(() => {
    if (!Number.isFinite(minutesParsed) || minutesParsed <= 0) return false;
    const capSec = typeof warehouseLifetime === 'bigint' ? warehouseLifetime : BigInt(0);
    return BigInt(minutesParsed) * BigInt(60) > capSec;
  }, [minutesParsed, warehouseLifetime]);

  return (
    <div className="space-y-3 pt-4 border-t border-border">
      <h4 className="font-semibold text-sm text-center">Apply Warehouse to Plant</h4>
      <p className="text-xs text-muted-foreground text-center">Available: {availablePtsHuman} PTS • {availableMinutes} min TOD</p>

      {/* Plant Selector */}
      <div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="w-full justify-between h-9 text-sm">
              {selectedPlantId ? (
                <div className="flex items-center gap-2">
                  <PlantImage selectedPlant={{ id: selectedPlantId, name: '', level: 0, score: 0, status: 0, rewards: 0, stars: 0, strain: 1, timeUntilStarving: 0, timePlantBorn: '0', lastAttackUsed: '0', lastAttacked: '0', statusStr: '', owner: address || '0x', extensions: [] }} width={20} height={20} />
                  <span>{plants.find(pl => pl.id === selectedPlantId)?.name || `Plant #${selectedPlantId}`}</span>
                </div>
              ) : 'Select Plant'}
              <ChevronDown className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width] max-h-60 overflow-y-auto">
            {plants.map(p => (
              <DropdownMenuItem key={p.id} onSelect={() => setSelectedPlantId(p.id)}>
                <div className="flex items-center gap-2">
                  <span>{p.name}</span>
                  <span className="text-xs text-muted-foreground">#{p.id}</span>
                </div>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Apply PTS */}
      <div className="grid grid-cols-[auto,1fr,auto] gap-2 items-center">
        <div className="text-xs text-muted-foreground px-2 py-1 rounded-md border border-border bg-card">PTS</div>
        <div className="relative">
          <Input
            value={applyPts}
            onChange={(e) => setApplyPts(e.target.value)}
            placeholder="Amount"
            inputMode="decimal"
            className={`h-9 text-sm pr-16 border-border ${ptsTooHigh ? 'border-red-500 focus-visible:ring-red-500' : ''}`}
          />
          <button
            type="button"
            onClick={() => setApplyPts(availablePtsHuman)}
            className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex items-center justify-center px-2 py-0.5 text-[10px] leading-none rounded-md bg-muted hover:bg-accent btn-compact"
          >
            Max
          </button>
        </div>
        {ptsTooHigh && (
          <div className="col-span-3 -mt-1 text-[11px] text-red-600">Amount exceeds available PTS.</div>
        )}
        <WarehouseApplyTransaction
          landId={landId}
          plantId={selectedPlantId || 0}
          amount={applyPts}
          mode="points"
          buttonText="Apply"
          buttonClassName="h-9 px-3 text-sm"
          disabled={!selectedPlantId || !applyPts || ptsTooHigh || ptsParsedScaled === null || ptsParsedScaled <= BigInt(0)}
          onSuccess={() => { toast.success('PTS applied'); setApplyPts(''); onApplySuccess(); try { window.dispatchEvent(new Event('buildings:refresh')); } catch {} try { fetch('/api/gamification/missions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address, taskId: 's2_apply_resources' }) }); } catch {} }}
          onError={(e) => toast.error(`Apply failed: ${e.message || e}`)}
        />
      </div>

      {/* Apply TOD (minutes) */}
      <div className="grid grid-cols-[auto,1fr,auto] gap-2 items-center">
        <div className="text-xs text-muted-foreground px-2 py-1 rounded-md border border-border bg-card">min</div>
        <div className="relative">
          <Input
            value={applyTodMinutes}
            onChange={(e) => setApplyTodMinutes(e.target.value)}
            placeholder="Minutes"
            inputMode="numeric"
            className={`h-9 text-sm pr-16 border-border ${minutesTooHigh ? 'border-red-500 focus-visible:ring-red-500' : ''}`}
          />
          <button
            type="button"
            onClick={() => setApplyTodMinutes(availableMinutes)}
            className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex items-center justify-center px-2 py-0.5 text-[10px] leading-none rounded-md bg-muted hover:bg-accent btn-compact"
          >
            Max
          </button>
        </div>
        {minutesTooHigh && (
          <div className="col-span-3 -mt-1 text-[11px] text-red-600">Minutes exceed available TOD.</div>
        )}
        <WarehouseApplyTransaction
          landId={landId}
          plantId={selectedPlantId || 0}
          amount={applyTodMinutes}
          mode="lifetime"
          buttonText="Apply"
          buttonClassName="h-9 px-3 text-sm"
          disabled={!selectedPlantId || !applyTodMinutes || minutesTooHigh || !Number.isFinite(minutesParsed) || minutesParsed <= 0}
          onSuccess={() => { toast.success('TOD applied'); setApplyTodMinutes(''); onApplySuccess(); try { window.dispatchEvent(new Event('buildings:refresh')); } catch {} try { fetch('/api/gamification/missions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address, taskId: 's2_apply_resources' }) }); } catch {} }}
          onError={(e) => toast.error(`Apply failed: ${e.message || e}`)}
        />
      </div>
      <p className="text-xs text-muted-foreground text-center">PTS up to 4 decimals. TOD input is minutes; converted to seconds on-chain.</p>
    </div>
  );
}
