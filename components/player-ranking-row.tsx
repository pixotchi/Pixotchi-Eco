"use client";

import Image from 'next/image';
import type { ReactNode } from 'react';
import { usePrimaryName } from './hooks/usePrimaryName';
import { WalletAvatar } from './ui/wallet-avatar';
import { TokenAmount } from './ui/token-amount';
import { formatPointsShare, type PlayerRankingRow as PlayerRow } from '@/lib/player-ranking';
import { formatAddress } from '@/lib/format-address';
import { cn } from '@/lib/utils';

export function PlayerRankingRow({ row, totalPoints, currentAddress, compact, rankIcon, onOpenProfile }: {
  row: PlayerRow;
  totalPoints: bigint;
  currentAddress?: string;
  compact?: boolean;
  rankIcon: ReactNode;
  onOpenProfile: (address: string) => void;
}) {
  const { name } = usePrimaryName(row.address);
  const isMine = currentAddress?.toLowerCase() === row.address;
  return (
    <div data-player-rank={row.rank} className={cn('flex min-w-0 items-center gap-2 text-foreground', compact ? 'py-2' : 'py-3', isMine && 'rounded-[var(--radius-control)] bg-primary/5 px-2')}>
      <span className="flex w-8 shrink-0 items-center justify-center text-sm font-semibold">{rankIcon}</span>
      <button type="button" onClick={() => onOpenProfile(row.address)}
        aria-label={`View ${name || formatAddress(row.address)} profile${isMine ? ', your wallet' : ''}`}
        className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-control)] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <WalletAvatar address={row.address} className="hidden h-8 w-8 shrink-0 rounded-full min-[380px]:block" />
        <span className="min-w-0">
          <span className="flex items-baseline gap-1 text-sm font-semibold">
            <span className="truncate">{name || formatAddress(row.address)}</span>
            {isMine && <span className="shrink-0 text-xs text-primary">(You)</span>}
          </span>
          <span className="block whitespace-nowrap text-xs text-muted-foreground">{row.plantCount.toLocaleString()} {row.plantCount === 1 ? 'plant' : 'plants'}</span>
        </span>
      </button>
      <span className="flex shrink-0 flex-col items-end gap-1 text-right">
        <span className="flex items-center gap-1 text-sm font-bold">
          <Image src="/icons/pts.svg" alt="" aria-hidden="true" width={14} height={14} />
          <TokenAmount amount={row.points} decimals={12} unit="PTS" mode="compact" />
        </span>
        <span className="text-xs tabular-nums text-muted-foreground" title="Share of total plant PTS">{formatPointsShare(row.points, totalPoints)}</span>
      </span>
    </div>
  );
}
