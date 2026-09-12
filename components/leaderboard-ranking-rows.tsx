'use client';

import Image from 'next/image';
import { WalletAvatar } from '@/components/ui/wallet-avatar';
import { cn, formatAddress } from '@/lib/utils';
import type { LandLeaderboardRow } from '@/lib/land-ranking';
import type { StakeLeaderboardEntry, RocksLeaderboardEntry } from '@/lib/ranking-response';

export const getRankIcon = (rank: number) => {
    switch (rank) {
      case 1:
        return <Image src="/icons/1st.svg" alt="1st Place" width={20} height={20} />;
      case 2:
        return <Image src="/icons/2nd.svg" alt="2nd Place" width={20} height={20} />;
      case 3:
        return <Image src="/icons/3rd.svg" alt="3rd Place" width={20} height={20} />;
      default:
        return null; // No icon for ranks beyond 3rd
    }
  };

export const getRankColor = (rank: number) => {
    switch (rank) {
      case 1:
        return "text-yellow-500 font-bold";
      case 2:
        return "text-gray-400 font-bold";
      case 3:
        return "text-amber-600 font-bold";
      default:
        return "text-foreground";
    }
  };


export const LandRankingRow = ({ row, compact = false }: { row: LandLeaderboardRow; compact?: boolean }) => (
    <div key={row.landId} className={compact ? "py-2" : "py-3"}>
      <div className="flex items-center space-x-2">
        <div className={cn("flex items-center justify-center", compact ? "w-7" : "w-8")}>
          <div className={`flex items-center ${getRankColor(row.rank)}`}>
            {row.rank <= 3 ? (
              getRankIcon(row.rank)
            ) : (
              <span className="text-sm font-semibold">#{row.rank}</span>
            )}
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center space-x-2">
            <h4 className={cn("font-pixel truncate pr-6", compact ? "text-sm" : "text-base")}>
              {row.name}
            </h4>
          </div>
        </div>
        <div className="flex items-center space-x-2 text-right">
          <div className="flex flex-col items-end space-y-1">
            <div className="flex items-center space-x-1">
              <Image src="/icons/pts.svg" alt="EXP" width={compact ? 14 : 16} height={compact ? 14 : 16} />
              <span className={cn("font-bold", compact ? "text-sm" : "text-base")}>{row.exp.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );


export const StakeRankingRow = ({ row, compact = false, address }: { row: StakeLeaderboardEntry; compact?: boolean; address?: string }) => {
    const formattedStake = (Number(row.stakedAmount) / 1e18).toLocaleString(undefined, {
      maximumFractionDigits: 2
    });
    const isCurrentUser = address && row.address.toLowerCase() === address.toLowerCase();

    return (
      <div
        key={row.address}
        className={cn(compact ? "py-2" : "py-3", isCurrentUser && "bg-primary/5 rounded-[var(--radius-control)] px-2 tablet:px-3")}
      >
        <div className="flex items-center space-x-2">
          <div className={cn("flex items-center justify-center", compact ? "w-7" : "w-8")}>
            <div className={`flex items-center ${getRankColor(row.rank)}`}>
              {row.rank <= 3 ? (
                getRankIcon(row.rank)
              ) : (
                <span className="text-sm font-semibold">#{row.rank}</span>
              )}
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-col">
              {row.ensName ? (
                <>
                  <h4 className={cn("font-semibold truncate pr-6", compact ? "text-sm" : "text-base")}>
                    {row.ensName}
                    {isCurrentUser && (
                      <span className="ml-2 text-xs text-primary font-medium">(You)</span>
                    )}
                  </h4>
                  <span className="text-xs text-muted-foreground font-mono truncate">
                    {formatAddress(row.address)}
                  </span>
                </>
              ) : compact ? (
                <>
                  <h4 className="font-semibold text-sm font-mono truncate pr-6">
                    {formatAddress(row.address)}
                    {isCurrentUser && (
                      <span className="ml-2 text-xs text-primary font-medium">(You)</span>
                    )}
                  </h4>
                  <span className="block h-4" aria-hidden="true" />
                </>
              ) : (
                <h4 className={cn("font-semibold font-mono truncate pr-6", compact ? "text-sm" : "text-base")}>
                  {formatAddress(row.address)}
                  {isCurrentUser && (
                    <span className="ml-2 text-xs text-primary font-medium">(You)</span>
                  )}
                </h4>
              )}
            </div>
          </div>
          <div className="flex items-center space-x-2 text-right">
            <div className="flex flex-col items-end space-y-1">
              <div className="flex items-center space-x-1">
                <Image src="/PixotchiKit/COIN.svg" alt="Staked SEED" width={compact ? 14 : 16} height={compact ? 14 : 16} />
                <span className={cn("font-bold", compact ? "text-sm" : "text-base")}>{formattedStake}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };


export const RockRankingRow = ({ row, compact = false, address }: { row: RocksLeaderboardEntry; compact?: boolean; address?: string }) => {
    const isCurrentUser = address && row.address?.toLowerCase() === address.toLowerCase();

    return (
      <div
        key={row.address || `rock-${row.rank}`}
        className={cn(compact ? "py-2" : "py-3", isCurrentUser && "bg-primary/5 rounded-[var(--radius-control)] px-2 tablet:px-3")}
      >
        <div className="flex items-center space-x-2">
          <div className={cn("flex items-center justify-center", compact ? "w-7" : "w-8")}>
            <div className={`flex items-center ${getRankColor(row.rank)}`}>
              {row.rank <= 3 ? (
                getRankIcon(row.rank)
              ) : (
                <span className="text-sm font-semibold">#{row.rank}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {row.address ? (
              <WalletAvatar
                address={row.address as `0x${string}`}
                className={cn("rounded-full", compact ? "w-8 h-8" : "w-10 h-10")}
              />
            ) : (
              <div className={cn("rounded-full bg-muted", compact ? "w-8 h-8" : "w-10 h-10")} />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h4 className={cn("font-semibold truncate pr-6", compact ? "text-sm" : "text-base")}>
              {row.name || (row.address ? formatAddress(row.address) : 'Unknown')}
              {isCurrentUser && (
                <span className="ml-2 text-xs text-primary font-medium">(You)</span>
              )}
            </h4>
            {row.name && row.address && (
              <span className="text-xs text-muted-foreground font-mono">
                {formatAddress(row.address)}
              </span>
            )}
          </div>
          <div className="flex items-center space-x-2 text-right">
            <div className="flex items-center space-x-1">
              <Image src="/icons/Volcanic_Rock.svg" alt="" width={compact ? 16 : 18} height={compact ? 16 : 18} aria-hidden="true" />
              <span className={cn("font-bold", compact ? "text-sm" : "text-base")}>{row.rocks.toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>
    );
  };
