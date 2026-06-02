"use client";

import { usePaymaster } from '@/lib/paymaster-context';
import { Zap } from 'lucide-react';
import { Badge } from './ui/badge';
import { cn } from '@/lib/utils';

interface PaymasterStatusProps {
  className?: string;
  showLabel?: boolean;
}

export function PaymasterStatus({
  className = "",
  showLabel = true
}: PaymasterStatusProps) {
  const { isPaymasterEnabled } = usePaymaster();

  if (!isPaymasterEnabled) return null;

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {showLabel && (
        <span className="text-sm text-muted-foreground">
          Sponsored TX:
        </span>
      )}
      <Badge variant="gasless">
        <Zap className="w-3 h-3" />
        <span>{showLabel ? 'Gasless Available' : 'Gasless'}</span>
      </Badge>
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
    <Badge variant="gasless" className={className}>
      <Zap className="w-3 h-3" />
      <span>Gasless</span>
    </Badge>
  );
}
