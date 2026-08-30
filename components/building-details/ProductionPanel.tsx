"use client";

import React from 'react';
import { useAccount } from 'wagmi';
import { BuildingData } from '@/lib/types';
import { formatProductionRate, formatLifetimeProduction, getFriendlyErrorMessage } from '@/lib/utils';
import BuildingClaimTransaction from '@/components/transactions/building-claim-transaction';
import { toast } from 'react-hot-toast';
import { extractTransactionHash } from '@/lib/transaction-utils';
import { postMissionProgress } from '@/lib/mission-tracking';

interface ProductionPanelProps {
  building: BuildingData;
  landId: bigint;
  onClaimSuccess: () => void;
}

export default function ProductionPanel({ building, landId, onClaimSuccess }: ProductionPanelProps) {
  const { address } = useAccount();
  return (
    <>
      <div className="space-y-2">
        {/* Production details */}
        <div className={`flex justify-between items-center text-sm transition-opacity duration-200 ${
          building.productionRatePlantPointsPerDay > 0 ? 'opacity-100' : 'opacity-0 h-0 overflow-hidden'
        }`}>
          <span className="text-muted-foreground">Production (PTS/Day):</span>
          <span className="font-semibold">
            {formatProductionRate(building.productionRatePlantPointsPerDay)}
          </span>
        </div>
        
        <div className={`flex justify-between items-center text-sm transition-opacity duration-200 ${
          building.productionRatePlantLifetimePerDay > 0 ? 'opacity-100' : 'opacity-0 h-0 overflow-hidden'
        }`}>
          <span className="text-muted-foreground">Production (TOD/Day):</span>
          <span className="font-semibold">
            {formatLifetimeProduction(building.productionRatePlantLifetimePerDay)}
          </span>
        </div>
        
        {/* Accumulated resources */}
        <div className={`flex justify-between items-center text-sm transition-opacity duration-200 ${
          building.accumulatedPoints > 0 ? 'opacity-100' : 'opacity-0 h-0 overflow-hidden'
        }`}>
          <span className="text-muted-foreground">Accumulated PTS:</span>
          <span className="font-semibold text-primary">
            {formatProductionRate(building.accumulatedPoints)}
          </span>
        </div>
        
        <div className={`flex justify-between items-center text-sm transition-opacity duration-200 ${
          building.accumulatedLifetime > 0 ? 'opacity-100' : 'opacity-0 h-0 overflow-hidden'
        }`}>
          <span className="text-muted-foreground">Accumulated TOD:</span>
          <span className="font-semibold text-primary">
            {formatLifetimeProduction(building.accumulatedLifetime)}
          </span>
        </div>
      </div>
      
      {/* Claim button */}
      {(building.accumulatedPoints > BigInt(0) || building.accumulatedLifetime > BigInt(0)) && (
        <div className="pt-2">
          <div className="chromatic-white-surface flex items-center justify-between rounded-[var(--radius-panel)] border border-border/60 bg-card/90 bg-[image:var(--gradient-surface)] p-2 shadow-[var(--shadow-hairline)]">
            <div className="text-xs sm:text-sm text-muted-foreground">Collect accumulated production into Warehouse</div>
            <BuildingClaimTransaction
              key={`${landId.toString()}-${building.id}`}
              landId={landId}
              buildingId={building.id}
              buttonText="Collect"
              buttonClassName="h-11 min-h-11 px-3 text-sm"
              onSuccess={(tx: UntypedValue) => { 
                toast.success('Collected to Warehouse'); 
                onClaimSuccess(); 
                window.dispatchEvent(new Event('buildings:refresh'));
                try {
                  const payload: Record<string, UntypedValue> = { address, taskId: 's3_claim_production' };
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
        </div>
      )}
    </>
  );
}
