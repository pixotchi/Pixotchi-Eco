"use client";

import React from 'react';
import { ProductionSummary } from './production-summary';
import { useAccount } from 'wagmi';
import { BuildingData } from '@/lib/types';
import { getFriendlyErrorMessage } from '@/lib/utils';
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
    <div className="space-y-4">
      <ProductionSummary building={building} />

      {/* Claim button */}
      {(building.accumulatedPoints > BigInt(0) || building.accumulatedLifetime > BigInt(0)) && (
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
            <div className="text-xs sm:text-sm text-muted-foreground">Collect stored plant resources into Warehouse</div>
            <BuildingClaimTransaction
              key={`${landId.toString()}-${building.id}`}
              landId={landId}
              buildingId={building.id}
              buttonText="Collect"
              buttonClassName="h-11 min-h-11 px-3 text-sm"
              onSuccess={(tx: UntypedValue) => { 

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
    </div>
  );
}
