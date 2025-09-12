"use client";

import React from 'react';
import { usePaymaster } from '@/lib/paymaster-context';
import { Zap, ZapOff } from 'lucide-react';

interface PaymasterStatusProps {
  className?: string;
  showLabel?: boolean;
}

export function PaymasterStatus({ 
  className = "", 
  showLabel = true
}: PaymasterStatusProps) {
  const { isPaymasterEnabled, isSponsored } = usePaymaster();

  if (!isPaymasterEnabled) return null;

  return (
    <div className={`flex items-center space-x-2 ${className}`}>
      {showLabel && (
        <span className="text-sm text-muted-foreground">
          Sponsored TX:
        </span>
      )}
      <div className="flex items-center space-x-1 px-2 py-1 rounded-md bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-xs font-medium">
        <Zap className="w-3 h-3" />
        <span>{showLabel ? 'Gasless Available' : 'Gasless'}</span>
      </div>
    </div>
  );
}

interface SponsoredBadgeProps {
  show: boolean;
  className?: string;
}

export function SponsoredBadge({ show, className = "" }: SponsoredBadgeProps) {
  if (!show) return null;

  return (
    <div className={`inline-flex items-center space-x-1 px-2 py-1 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-xs font-medium ${className}`}>
      <Zap className="w-3 h-3" />
      <span>Gasless</span>
    </div>
  );
} 