"use client";

import { useMemo } from 'react';
import { usePaymaster } from '@/lib/paymaster-context';
import { useSmartWallet } from '@/lib/smart-wallet-context';
import { SponsoredBadge } from '@/components/paymaster-toggle';
import { PIXOTCHI_NFT_ADDRESS } from '@/lib/contracts';
import SponsoredTransaction from './sponsored-transaction';

const PIXOTCHI_NFT_ABI = [
  {
    inputs: [
      { name: '_id', type: 'uint256' },
      { name: '_name', type: 'string' },
    ],
    name: 'setPlantName',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

interface PlantNameTransactionProps {
  plantId: number;
  newName: string;
  onSuccess?: (tx: UntypedValue) => void;
  onError?: (error: UntypedValue) => void;
  buttonText?: string;
  buttonClassName?: string;
  disabled?: boolean;
  hideLabel?: boolean;
  /** Fires when the actual transaction button is pressed (not on wrapper clicks). */
  onButtonClick?: () => void;
}

export function PlantNameTransaction({
  plantId,
  newName,
  onSuccess,
  onError,
  buttonText = "Change Name (350 SEED)",
  buttonClassName,
  disabled = false,
  hideLabel = false,
  onButtonClick,
}: PlantNameTransactionProps) {
  const { isSponsored } = usePaymaster();
  const { isSmartWallet } = useSmartWallet();
  const calls = useMemo(() => [{
    address: PIXOTCHI_NFT_ADDRESS,
    abi: PIXOTCHI_NFT_ABI,
    functionName: 'setPlantName',
    args: [BigInt(plantId), newName],
  }], [newName, plantId]);

  return (
    <div className="space-y-2">
      {!hideLabel && (
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{buttonText}</span>
          <SponsoredBadge show={isSponsored && isSmartWallet} />
        </div>
      )}

      <SponsoredTransaction
        intentKey={`set-plant-name:${plantId}:${newName.trim()}`}
        calls={calls}
        onSuccess={onSuccess}
        onError={onError}
        buttonText={buttonText}
        buttonClassName={buttonClassName}
        disabled={disabled}
        onButtonClick={onButtonClick}
      />
    </div>
  );
}
