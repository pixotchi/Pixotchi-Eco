"use client";

import React from 'react';
import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';

interface DisabledTransactionProps {
  buttonText: string;
  buttonClassName?: string;
}

export default function DisabledTransaction({
  buttonText,
  buttonClassName = ""
}: DisabledTransactionProps) {
  return (
    <button
      type="button"
      className={cn(buttonVariants({ variant: 'default' }), 'cursor-not-allowed opacity-60 select-none', buttonClassName,
        'h-auto min-w-0 max-w-full whitespace-normal leading-snug [overflow-wrap:anywhere]')}
      disabled
    >
      {buttonText}
    </button>
  );
}
