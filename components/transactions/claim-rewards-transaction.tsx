"use client";

import { useMemo } from 'react';
import { PIXOTCHI_NFT_ADDRESS } from '@/lib/contracts';
import UniversalTransaction from './universal-transaction';

const PIXOTCHI_NFT_ABI = [
  {
    inputs: [{ name: 'id', type: 'uint256' }],
    name: 'redeem',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

interface ClaimRewardsTransactionProps {
  plantId: number;
  onSuccess?: (tx: UntypedValue) => void;
  onError?: (error: UntypedValue) => void;
  buttonText?: string;
  buttonClassName?: string;
  disabled?: boolean;
  minimal?: boolean;
}

export default function ClaimRewardsTransaction({
  plantId,
  onSuccess,
  onError,
  buttonText = "Yes, Claim",
  buttonClassName,
  disabled = false,
  minimal = false,
}: ClaimRewardsTransactionProps) {
  const calls = useMemo(() => [{
    address: PIXOTCHI_NFT_ADDRESS,
    abi: PIXOTCHI_NFT_ABI,
    functionName: 'redeem',
    args: [BigInt(plantId)],
  }], [plantId]);

  return (
    <div className={minimal ? undefined : "space-y-2"}>
      {!minimal && (
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{buttonText}</span>
        </div>
      )}

      <UniversalTransaction
        intentKey={`claim-plant-rewards:${plantId}`}
        calls={calls}
        onSuccess={onSuccess}
        onError={onError}
        buttonText={buttonText}
        buttonClassName={buttonClassName}
        disabled={disabled}
        forceUnsponsored
      />
    </div>
  );
}
