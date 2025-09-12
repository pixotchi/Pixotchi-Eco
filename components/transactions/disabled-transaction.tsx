"use client";

import React from 'react';
import { Transaction, TransactionButton } from '@coinbase/onchainkit/transaction';

interface DisabledTransactionProps {
  buttonText: string;
  buttonClassName?: string;
  message?: string;
}

export default function DisabledTransaction({
  buttonText,
  buttonClassName = "",
  message
}: DisabledTransactionProps) {
  // Empty/invalid call that will never execute but keeps OnchainKit styling
  const dummyCalls = [{
    address: '0x0000000000000000000000000000000000000000' as `0x${string}`,
    abi: [],
    functionName: 'disabled',
    args: [],
  }];

  return (
    <Transaction calls={dummyCalls}>
      <TransactionButton 
        text={buttonText}
        className={buttonClassName}
        disabled={true}
      />
    </Transaction>
  );
} 