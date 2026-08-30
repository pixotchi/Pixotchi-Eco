"use client";

import CountdownTimer from '@/components/countdown-timer';
import PlantImage from '@/components/PlantImage';
import WarehouseApplyTransaction from '@/components/transactions/warehouse-apply-transaction';
import { Button } from '@/components/ui/button';
import { DropdownMenu,DropdownMenuContent,DropdownMenuItem,DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { getPlantsByOwner } from '@/lib/contracts';
import { postMissionProgress } from '@/lib/mission-tracking';
import { extractTransactionHash } from '@/lib/transaction-utils';
import { Plant } from '@/lib/types';
import { getFriendlyErrorMessage } from '@/lib/utils';
import { ChevronDown } from 'lucide-react';
import { useCallback,useEffect,useId,useMemo,useRef,useState } from 'react';
import { toast } from 'react-hot-toast';
import { useAccount } from 'wagmi';

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
  const [plants, setPlants] = useState<Plant[]>([]);
  const [plantsOwner, setPlantsOwner] = useState<string | null>(null);
  const [selectedPlantId, setSelectedPlantId] = useState<number | null>(null);
  const [applyPts, setApplyPts] = useState<string>("");
  const [applyTodMinutes, setApplyTodMinutes] = useState<string>("");
  const availableDescriptionId = useId();
  const pointsInputId = useId();
  const pointsErrorId = useId();
  const lifetimeInputId = useId();
  const lifetimeErrorId = useId();
  const normalizedOwner = address?.toLowerCase() ?? null;
  const currentOwnerRef = useRef<string | null>(normalizedOwner);
  const plantsRequestRef = useRef(0);
  currentOwnerRef.current = normalizedOwner;

  const loadPlants = useCallback(async () => {
    const requestOwner = normalizedOwner;
    const requestId = ++plantsRequestRef.current;
    if (!address || !requestOwner) return;
    try {
      const list = await getPlantsByOwner(address);
      if (
        requestId !== plantsRequestRef.current
        || currentOwnerRef.current !== requestOwner
      ) return;
      setPlants(list);
      setPlantsOwner(requestOwner);
      setSelectedPlantId((current) => (
        current !== null && list.some((plant) => plant.id === current)
          ? current
          : (list[0]?.id ?? null)
      ));
    } catch {
      if (
        requestId !== plantsRequestRef.current
        || currentOwnerRef.current !== requestOwner
      ) return;
      setPlants([]);
      setPlantsOwner(null);
      setSelectedPlantId(null);
    }
  }, [address, normalizedOwner]);

  useEffect(() => {
    // Fail closed as soon as the connected owner changes. A late response from
    // the previous wallet is fenced both by generation and by owner identity.
    plantsRequestRef.current += 1;
    setPlants([]);
    setPlantsOwner(null);
    setSelectedPlantId(null);
    setApplyPts('');
    setApplyTodMinutes('');
    if (normalizedOwner) void loadPlants();

    return () => {
      plantsRequestRef.current += 1;
    };
  }, [loadPlants, normalizedOwner]);

  const plantsAreCurrent = normalizedOwner !== null && plantsOwner === normalizedOwner;
  const currentPlants = plantsAreCurrent ? plants : [];
  const currentSelectedPlantId = plantsAreCurrent ? selectedPlantId : null;

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
    if (!trimmed || !/^(?:\d+(?:\.\d{0,4})?|\.\d{1,4})$/.test(trimmed)) return null;
    try {
      const [whole, dec = ''] = trimmed.split('.');
      const frac12 = dec.padEnd(12, '0');
      return BigInt((whole || '0') + frac12);
    } catch {
      return null;
    }
  }, []);

  const ptsParsedScaled = useMemo(() => parsePtsToScaled(applyPts), [applyPts, parsePtsToScaled]);
  const ptsInvalid = Boolean(applyPts) && (ptsParsedScaled === null || ptsParsedScaled <= BigInt(0));
  const ptsTooHigh = useMemo(() => {
    if (ptsParsedScaled === null) return false;
    const cap = typeof warehousePoints === 'bigint' ? warehousePoints : BigInt(0);
    return ptsParsedScaled > cap;
  }, [ptsParsedScaled, warehousePoints]);

  const minutesParsed = useMemo(() => {
    const value = applyTodMinutes.trim();
    if (!/^\d+$/.test(value)) return null;
    try { return BigInt(value); } catch { return null; }
  }, [applyTodMinutes]);
  const minutesInvalid = Boolean(applyTodMinutes) && (minutesParsed === null || minutesParsed <= BigInt(0));
  const minutesTooHigh = useMemo(() => {
    if (minutesParsed === null || minutesParsed <= BigInt(0)) return false;
    const capSec = typeof warehouseLifetime === 'bigint' ? warehouseLifetime : BigInt(0);
    return minutesParsed * BigInt(60) > capSec;
  }, [minutesParsed, warehouseLifetime]);

  return (
    <div className="space-y-3 pt-4 border-t border-border">
      <h4 className="font-semibold text-sm text-center">Apply Warehouse to Plant</h4>
      <p id={availableDescriptionId} className="text-xs text-muted-foreground text-center">Available: {availablePtsHuman} PTS • {availableMinutes} min TOD</p>

      {/* Plant Selector */}
      <div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="w-full justify-between h-12 text-sm">
              {currentSelectedPlantId ? (
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <PlantImage selectedPlant={{ id: currentSelectedPlantId, name: '', level: 0, score: 0, status: 0, rewards: 0, stars: 0, strain: 1, timeUntilStarving: 0, timePlantBorn: '0', lastAttackUsed: '0', lastAttacked: '0', statusStr: '', owner: address || '0x', extensions: [] }} width={20} height={20} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{currentPlants.find(pl => pl.id === currentSelectedPlantId)?.name || `Plant #${currentSelectedPlantId}`}</div>
                    <div className="text-xs text-muted-foreground">#{currentSelectedPlantId}</div>
                  </div>
                  <div className="flex-shrink-0">
                    <CountdownTimer 
                      timeUntilStarving={currentPlants.find(pl => pl.id === currentSelectedPlantId)?.timeUntilStarving || 0}
                      noBackground={true} 
                      className="text-xs"
                      showSeconds={false}
                    />
                  </div>
                </div>
              ) : 'Select Plant'}
              <ChevronDown className="w-4 h-4 flex-shrink-0" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width] max-h-60 overflow-y-auto">
            {currentPlants.map(p => (
              <DropdownMenuItem key={p.id} onSelect={() => setSelectedPlantId(p.id)} className="h-16">
                <div className="flex items-center gap-2 w-full">
                  <PlantImage selectedPlant={p} width={20} height={20} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{p.name || `Plant #${p.id}`}</div>
                    <div className="text-xs text-muted-foreground">#{p.id}</div>
                  </div>
                  <div className="flex-shrink-0">
                    <CountdownTimer 
                      timeUntilStarving={p.timeUntilStarving} 
                      noBackground={true} 
                      className="text-xs"
                      showSeconds={false}
                    />
                  </div>
                </div>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Apply PTS */}
      <div className="grid grid-cols-[1fr,auto] gap-2 items-center">
        <div className="relative">
          <label htmlFor={pointsInputId} className="sr-only">Warehouse points amount</label>
          <Input
            id={pointsInputId}
            value={applyPts}
            onChange={(e) => setApplyPts(e.target.value)}
            placeholder="Amount"
            inputMode="decimal"
            aria-invalid={ptsTooHigh || ptsInvalid}
            aria-describedby={ptsTooHigh || ptsInvalid ? `${availableDescriptionId} ${pointsErrorId}` : availableDescriptionId}
            className={`h-11 text-sm pr-20 border-border ${ptsTooHigh || ptsInvalid ? 'border-destructive focus-visible:ring-destructive' : ''}`}
          />
          <Button
            type="button"
            variant="ghost"
            size="default"
            onClick={() => setApplyPts(availablePtsHuman)}
            className="absolute right-0 top-0 h-11 min-h-11 rounded-l-none px-3 text-xs"
          >
            Max
          </Button>
        </div>
        {(ptsTooHigh || ptsInvalid) && (
          <div id={pointsErrorId} role="alert" className="col-span-2 -mt-1 text-xs text-destructive">
            {ptsTooHigh ? 'Amount exceeds available PTS.' : 'Enter a positive PTS amount with up to 4 decimal places.'}
          </div>
        )}
        <WarehouseApplyTransaction
          landId={landId}
          plantId={currentSelectedPlantId || 0}
          amount={applyPts}
          mode="points"
          buttonText="Apply"
          buttonClassName="h-11 min-h-11 px-4 text-sm"
          disabled={!currentSelectedPlantId || !applyPts || ptsTooHigh || ptsInvalid}
          onSuccess={(tx: UntypedValue) => {
            toast.success('PTS applied');
            setApplyPts('');
            onApplySuccess();
            try { window.dispatchEvent(new Event('buildings:refresh')); } catch {}
            try {
              const payload: Record<string, UntypedValue> = { address, taskId: 's3_apply_resources' };
              const txHash = extractTransactionHash(tx);
              if (txHash) {
                payload.proof = { txHash };
              }
              postMissionProgress(payload);
            } catch {}
          }}
          onError={(e) => toast.error(getFriendlyErrorMessage(e))}
        />
      </div>

      {/* Apply TOD (minutes) */}
      <div className="grid grid-cols-[1fr,auto] gap-2 items-center">
        <div className="relative">
          <label htmlFor={lifetimeInputId} className="sr-only">Warehouse lifetime in minutes</label>
          <Input
            id={lifetimeInputId}
            value={applyTodMinutes}
            onChange={(e) => setApplyTodMinutes(e.target.value)}
            placeholder="Minutes"
            inputMode="numeric"
            aria-invalid={minutesTooHigh || minutesInvalid}
            aria-describedby={minutesTooHigh || minutesInvalid ? `${availableDescriptionId} ${lifetimeErrorId}` : availableDescriptionId}
            className={`h-11 text-sm pr-20 border-border ${minutesTooHigh || minutesInvalid ? 'border-destructive focus-visible:ring-destructive' : ''}`}
          />
          <Button
            type="button"
            variant="ghost"
            size="default"
            onClick={() => setApplyTodMinutes(availableMinutes)}
            className="absolute right-0 top-0 h-11 min-h-11 rounded-l-none px-3 text-xs"
          >
            Max
          </Button>
        </div>
        {(minutesTooHigh || minutesInvalid) && (
          <div id={lifetimeErrorId} role="alert" className="col-span-2 -mt-1 text-xs text-destructive">
            {minutesTooHigh ? 'Minutes exceed available TOD.' : 'Enter a positive whole number of minutes.'}
          </div>
        )}
        <WarehouseApplyTransaction
          landId={landId}
          plantId={currentSelectedPlantId || 0}
          amount={applyTodMinutes}
          mode="lifetime"
          buttonText="Apply"
          buttonClassName="h-11 min-h-11 px-4 text-sm"
          disabled={!currentSelectedPlantId || !applyTodMinutes || minutesTooHigh || minutesInvalid}
          onSuccess={(tx: UntypedValue) => {
            toast.success('TOD applied');
            setApplyTodMinutes('');
            onApplySuccess();
            try { window.dispatchEvent(new Event('buildings:refresh')); } catch {}
            try {
              const payload: Record<string, UntypedValue> = { address, taskId: 's3_apply_resources' };
              const txHash = extractTransactionHash(tx);
              if (txHash) {
                payload.proof = { txHash };
              }
              postMissionProgress(payload);
            } catch {}
          }}
          onError={(e) => toast.error(getFriendlyErrorMessage(e))}
        />
      </div>
      <p className="text-xs text-muted-foreground text-center">PTS up to 4 decimals. TOD input is minutes; converted to seconds onchain.</p>
    </div>
  );
}
