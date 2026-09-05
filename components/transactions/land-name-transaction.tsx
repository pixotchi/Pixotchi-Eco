"use client";

import React from 'react';
import GameTransaction from './game-transaction';
import { landAbi } from '@/public/abi/pixotchi-v3-abi';
import { LAND_CONTRACT_ADDRESS } from '@/lib/contracts';

interface LandNameTransactionProps {
  landId: bigint;
  newName: string;
  onSuccess?: (data: UntypedValue) => void;
  onError?: (error: Error) => void;
  disabled?: boolean;
  buttonText?: string;
  buttonClassName?: string;
  onButtonClick?: () => void;
}

export function LandNameTransaction({
  landId,
  newName,
  onSuccess,
  onError,
  disabled = false,
  buttonText = "Confirm Transaction",
  buttonClassName = "",
  onButtonClick
}: LandNameTransactionProps) {

  const calls = [{
    address: LAND_CONTRACT_ADDRESS,
    abi: landAbi,
    functionName: 'landSetName',
    args: [landId, newName],
  }];

  return (
    <GameTransaction
      successMessage={`Land #${landId} renamed to ${newName}`}
      effects={{ domains: ["lands"] }}
      intentKey={`set-land-name:${landId}`}
      calls={calls}
      onSuccess={onSuccess}
      onError={error => onError?.(error instanceof Error ? error : new Error('Land name could not be changed.'))}
      buttonText={buttonText}
      buttonClassName={buttonClassName}
      disabled={disabled}
      onButtonClick={onButtonClick}
    />
  );
}

