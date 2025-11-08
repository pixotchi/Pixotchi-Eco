"use client";

import React from 'react';
import { useAccount } from 'wagmi';
import { BuildingData } from '@/lib/types';
import { formatProductionRate, formatLifetimeProduction } from '@/lib/utils';
import BuildingClaimTransaction from '@/components/transactions/building-claim-transaction';
import { toast } from 'react-hot-toast';
import { StandardContainer } from '@/components/ui/pixel-container';
import { extractTransactionHash } from '@/lib/transaction-utils';

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
          <StandardContainer className="flex items-center justify-between p-2 rounded-lg border bg-card">
            <div className="text-xs sm:text-sm text-muted-foreground">Collect accumulated production into Warehouse</div>
            <BuildingClaimTransaction
              landId={landId}
              buildingId={building.id}
              buttonText="Collect"
              buttonClassName="h-9 px-3 text-sm"
              onSuccess={(tx: any) => { 
                toast.success('Collected to Warehouse'); 
                onClaimSuccess(); 
                window.dispatchEvent(new Event('balances:refresh'));
                window.dispatchEvent(new Event('buildings:refresh'));
                try {
                  const payload: Record<string, unknown> = { address, taskId: 's1_claim_production' };
                  const txHash = extractTransactionHash(tx);
                  if (txHash) {
                    payload.proof = { txHash };
                  }
                  fetch('/api/gamification/missions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                  });
                } catch {}
              }}
              onError={(e) => toast.error(`Collect failed: ${e.message || e}`)}
            />
          </StandardContainer>
        </div>
      )}
    </>
  );
}
