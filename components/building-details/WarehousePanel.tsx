"use client";

import { PlantResourcePicker } from './plant-resource-picker';

import WarehouseApplyTransaction from '@/components/transactions/warehouse-apply-transaction';
import { AmountField } from '@/components/ui/amount-field';
import { Button } from '@/components/ui/button';
import { ResourceState } from '@/components/ui/resource-state';
import { ResourceValue } from '@/components/ui/resource-value';
import { getPlantsByOwner } from '@/lib/contracts';
import { useFarmView } from '@/lib/farm-view-context';
import { navigateToGameTab } from '@/lib/game-navigation';
import { postMissionProgress } from '@/lib/mission-tracking';
import { extractTransactionHash } from '@/lib/transaction-utils';
import { Plant } from '@/lib/types';
import { getFriendlyErrorMessage } from '@/lib/utils';
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
  const { setMintType } = useFarmView();
  const [plantsLoading, setPlantsLoading] = useState(false);
  const [plantsError, setPlantsError] = useState<string | null>(null);
  const [plants, setPlants] = useState<Plant[]>([]);
  const [plantsOwner, setPlantsOwner] = useState<string | null>(null);
  const [selectedPlantId, setSelectedPlantId] = useState<number | null>(null);
  const [applyPts, setApplyPts] = useState<string>("");
  const [applyTodMinutes, setApplyTodMinutes] = useState<string>("");
  const availableDescriptionId = useId();
  const pointsInputId = useId();
  const lifetimeInputId = useId();
  const normalizedOwner = address?.toLowerCase() ?? null;
  const currentOwnerRef = useRef<string | null>(normalizedOwner);
  const plantsRequestRef = useRef(0);
  currentOwnerRef.current = normalizedOwner;

  const loadPlants = useCallback(async () => {
    const requestOwner = normalizedOwner;
    const requestId = ++plantsRequestRef.current;
    if (!address || !requestOwner) return;
    setPlantsLoading(true);
    setPlantsError(null);
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
      setPlantsError('Your plants could not be loaded. Retry before applying resources.');
    } finally {
      if (requestId === plantsRequestRef.current && currentOwnerRef.current === requestOwner) setPlantsLoading(false);
    }
  }, [address, normalizedOwner]);

  useEffect(() => {
    // Fail closed as soon as the connected owner changes. A late response from
    // the previous wallet is fenced both by generation and by owner identity.
    plantsRequestRef.current += 1;
    setPlants([]);
    setPlantsOwner(null);
    setSelectedPlantId(null);
    setPlantsLoading(false);
    setPlantsError(null);
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
  const draftRef = useRef({ owner: normalizedOwner, landId, plantId: currentSelectedPlantId,
    points: applyPts, lifetime: applyTodMinutes, pointsRevision: 0, lifetimeRevision: 0 });
  const previousDraft = draftRef.current;
  const scopeChanged = previousDraft.owner !== normalizedOwner || previousDraft.landId !== landId
    || previousDraft.plantId !== currentSelectedPlantId;
  const pointsRevision = previousDraft.pointsRevision + (scopeChanged || previousDraft.points !== applyPts ? 1 : 0);
  const lifetimeRevision = previousDraft.lifetimeRevision + (scopeChanged || previousDraft.lifetime !== applyTodMinutes ? 1 : 0);
  draftRef.current = { owner: normalizedOwner, landId, plantId: currentSelectedPlantId,
    points: applyPts, lifetime: applyTodMinutes, pointsRevision, lifetimeRevision };

  const completeApply = (mode: 'points' | 'lifetime', tx: unknown) => {
    const current = draftRef.current;
    if (current.owner !== normalizedOwner) return;
    if (current.landId === landId) {
      // Returning to the same plant or amount still creates a new draft revision.
      if (mode === 'points' && current.pointsRevision === pointsRevision) setApplyPts('');
      if (mode === 'lifetime' && current.lifetimeRevision === lifetimeRevision) setApplyTodMinutes('');
      onApplySuccess();
    }
    try { window.dispatchEvent(new Event('buildings:refresh')); } catch {}
    try {
      const txHash = extractTransactionHash(tx);
      postMissionProgress({ address: normalizedOwner, taskId: 's3_apply_resources',
        ...(txHash ? { proof: { txHash } } : {}) });
    } catch {}
  };

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
    <div className="space-y-4">
      <h4 className="font-semibold text-sm">Apply stored resources</h4>
      <p id={availableDescriptionId} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
        <span>Available:</span>
        <ResourceValue resource="points">{availablePtsHuman} PTS</ResourceValue>
        <ResourceValue resource="lifetime">{availableMinutes} min plant lifetime</ResourceValue>
      </p>

      {plantsError ? <ResourceState status="error" title="Plants unavailable" description={plantsError} onRetry={() => void loadPlants()} />
        : plantsLoading ? <ResourceState status="loading" title="Loading your plants…" />
        : plantsAreCurrent && currentPlants.length === 0 ? <div className="space-y-3">
          <ResourceState status="empty" title="No plants in this wallet" description="Your resources will stay in the warehouse until you have a plant to use them." />
          <Button className="w-full" onClick={() => { setMintType('plant'); navigateToGameTab('mint'); }}>Get your first plant</Button>
        </div> : null}

      <div hidden={!plantsAreCurrent || currentPlants.length === 0} className="space-y-3">
      <PlantResourcePicker plants={currentPlants} selectedId={currentSelectedPlantId}
        onChange={setSelectedPlantId} disabled={!plantsAreCurrent || currentPlants.length === 0} />

      {/* Apply PTS */}
      <div className="space-y-3">
        <AmountField id={pointsInputId} label="Plant points to apply" unit="PTS" value={applyPts} onChange={e => setApplyPts(e.target.value)} onMax={() => setApplyPts(availablePtsHuman)} balance={availablePtsHuman} error={ptsTooHigh ? 'Amount exceeds available PTS.' : ptsInvalid ? 'Enter a positive amount with up to 4 decimal places.' : undefined} />
        <WarehouseApplyTransaction
          landId={landId}
          plantId={currentSelectedPlantId || 0}
          amount={applyPts}
          mode="points"
          buttonText="Apply points"
          buttonClassName="h-11 min-h-11 w-full px-4 text-sm"
          disabled={!currentSelectedPlantId || !applyPts || ptsTooHigh || ptsInvalid}
          onSuccess={(tx) => completeApply('points', tx)}
          onError={(e) => toast.error(getFriendlyErrorMessage(e))}
        />
      </div>

      {/* Apply TOD (minutes) */}
      <div className="space-y-3">
        <AmountField id={lifetimeInputId} label="Plant lifetime to apply" unit="minutes" value={applyTodMinutes} onChange={e => setApplyTodMinutes(e.target.value)} inputMode="numeric" onMax={() => setApplyTodMinutes(availableMinutes)} balance={availableMinutes} error={minutesTooHigh ? 'Amount exceeds available lifetime.' : minutesInvalid ? 'Enter a positive whole number of minutes.' : undefined} />
        <WarehouseApplyTransaction
          landId={landId}
          plantId={currentSelectedPlantId || 0}
          amount={applyTodMinutes}
          mode="lifetime"
          buttonText="Apply lifetime"
          buttonClassName="h-11 min-h-11 w-full px-4 text-sm"
          disabled={!currentSelectedPlantId || !applyTodMinutes || minutesTooHigh || minutesInvalid}
          onSuccess={(tx) => completeApply('lifetime', tx)}
          onError={(e) => toast.error(getFriendlyErrorMessage(e))}
        />
      </div>
      <p className="text-xs text-muted-foreground">Apply plant points with up to 4 decimal places, or plant lifetime in whole minutes.</p>
      </div>
    </div>
  );
}
