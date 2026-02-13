"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import {
    casinoIsBuilt,
    casinoGetBuildingConfig,
    casinoGetConfig,
    casinoGetStats,
    blackjackGetStats,
    buildCasinoBuildCall,
    checkCasinoApproval,
    LAND_CONTRACT_ADDRESS,
    PIXOTCHI_TOKEN_ADDRESS
} from '@/lib/contracts';
import { formatTokenAmount } from '@/lib/utils';
import SponsoredTransaction from '@/components/transactions/sponsored-transaction';
import ApproveTransaction from '@/components/transactions/approve-transaction';
import CasinoDialog from '@/components/transactions/CasinoDialog';
import BlackjackDialog from '@/components/transactions/BlackjackDialog';
import { toast } from 'react-hot-toast';
import { useWalletClient, useAccount, useBalance } from 'wagmi';
import { useTokenSymbol } from '@/hooks/useTokenSymbol';

interface CasinoPanelProps {
    landId: bigint;
    onSpinComplete?: () => void;
}

export default function CasinoPanel({ landId, onSpinComplete }: CasinoPanelProps) {
    const { data: walletClient } = useWalletClient();
    const { address } = useAccount();

    const formatWholeNumber = useCallback((num: bigint): string => {
        const text = num.toString();
        return text.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }, []);

    // Build cost is configured as a token amount and is expected to be whole-token in practice.
    // Round to nearest whole token for stable UX (avoids 499,999.99-style display from tiny wei drift).
    const formatBuildCostRounded = useCallback((amount: bigint, decimals: number): string => {
        if (amount <= BigInt(0)) return '0';
        const divisor = BigInt(10) ** BigInt(decimals);
        const roundedWhole = (amount + (divisor / BigInt(2))) / divisor;
        return formatWholeNumber(roundedWhole);
    }, [formatWholeNumber]);

    // State
    const [isBuilt, setIsBuilt] = useState<boolean | null>(null);
    const [buildingConfig, setBuildingConfig] = useState<{ token: string; cost: bigint } | null>(null);
    const [bettingTokenAddress, setBettingTokenAddress] = useState<string | null>(null);
    const [stats, setStats] = useState<{ wagered: bigint; won: bigint; games: bigint } | null>(null);
    const [bjStats, setBjStats] = useState<{ wagered: bigint; won: bigint; games: bigint } | null>(null);

    // Approval state
    const [allowanceWei, setAllowanceWei] = useState(BigInt(0));

    // UI State
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [casinoOpen, setCasinoOpen] = useState(false);
    const [blackjackOpen, setBlackjackOpen] = useState(false);

    const { data: buildTokenBalance, refetch: refetchBuildTokenBalance } = useBalance({
        address,
        token: buildingConfig?.token as `0x${string}` | undefined,
        query: {
            enabled: !!address && !!buildingConfig && !isBuilt,
        },
    });

    const buildTokenDecimals = buildTokenBalance?.decimals ?? 18;
    const buildCostWei = buildingConfig?.cost ?? BigInt(0);
    const isBuildBalanceLoaded = !address || !buildingConfig || !!buildTokenBalance;
    const hasSufficientBalance =
        !!buildingConfig &&
        !!buildTokenBalance &&
        buildTokenBalance.value >= buildCostWei;
    const hasApproval = allowanceWei >= buildCostWei;
    const buildCostDisplay = buildingConfig
        ? formatBuildCostRounded(buildingConfig.cost, buildTokenDecimals)
        : '...';

    // Load casino state
    const loadCasinoState = useCallback(async () => {
        try {
            setIsLoading(true);
            setError(null);

            const [built, bConfig, gConfig, casinoStats, blackjackStats] = await Promise.all([
                casinoIsBuilt(landId),
                casinoGetBuildingConfig(),
                casinoGetConfig(),
                casinoGetStats(landId),
                blackjackGetStats(landId)
            ]);

            setIsBuilt(built);

            if (gConfig) {
                setBettingTokenAddress(gConfig.bettingToken);
            }
            let tokenAddress = PIXOTCHI_TOKEN_ADDRESS;

            if (bConfig) {
                setBuildingConfig({ token: bConfig.buildingToken, cost: bConfig.buildingCost });
                // Use the configured token if it's set (and not potentially address(0) if that's possible, though contract handles it)
                // The contract _getBuildingToken fallback handles address(0), but here we get the raw value.
                // If address(0), we should use PIXOTCHI_TOKEN_ADDRESS (SEED). 
                // However, let's assume if it returns non-zero, we use it. 
                // Wait, contract returns: `address token = LibRouletteStorage.data().buildingToken; if (token == address(0)) return LibConstants.paymentGetSeedToken();`
                // So contract `casinoGetBuildingConfig` returns the RESOLVED token address?
                // `casinoGetBuildingConfig` calls `_getBuildingToken()`.
                // YES. It returns the resolved address. So we can trust `bConfig.buildingToken`.
                tokenAddress = bConfig.buildingToken as `0x${string}`; // Cast to match inferred type if PIXOTCHI_TOKEN_ADDRESS is typed consistently
            }

            if (casinoStats) {
                setStats({ wagered: casinoStats.totalWagered, won: casinoStats.totalWon, games: casinoStats.gamesPlayed });
            }

            if (blackjackStats) {
                setBjStats({ wagered: blackjackStats.totalWagered, won: blackjackStats.totalWon, games: blackjackStats.gamesPlayed });
            }

            // Check approval
            if (address && !built) {
                const approval = await checkCasinoApproval(address, tokenAddress as `0x${string}`);
                setAllowanceWei(approval);
            } else {
                setAllowanceWei(BigInt(0));
            }

        } catch (err) {
            console.error('Failed to load casino state:', err);
            setError('Failed to load casino data');
        } finally {
            setIsLoading(false);
        }
    }, [landId, address]);

    useEffect(() => {
        loadCasinoState();
    }, [loadCasinoState]);

    // Use the hook to get the symbol
    const tokenSymbol = useTokenSymbol(buildingConfig?.token);
    const displaySymbol = tokenSymbol || 'SEED'; // Fallback while loading or if hooks returns default

    const bettingTokenSymbol = useTokenSymbol(bettingTokenAddress || undefined);
    const displayBettingSymbol = bettingTokenSymbol || 'SEED';

    // Handle successful build
    const onBuildSuccess = useCallback(async () => {
        toast.success("Casino built successfully!");
        await loadCasinoState();
        if (onSpinComplete) onSpinComplete();
    }, [loadCasinoState, onSpinComplete]);

    // Handle approval success
    const onApproveSuccess = useCallback(async () => {
        toast.success("Token approved!");
        await refetchBuildTokenBalance();
        // Re-check approval
        if (address && buildingConfig) {
            const approval = await checkCasinoApproval(address, buildingConfig.token);
            setAllowanceWei(approval);
        }
    }, [address, buildingConfig, refetchBuildTokenBalance]);

    // Handle spin complete (refresh stats)
    const handleSpinComplete = useCallback(async () => {
        await loadCasinoState();
        if (onSpinComplete) onSpinComplete();
    }, [loadCasinoState, onSpinComplete]);

    // Loading state
    if (isLoading && isBuilt === null) {
        return (
            <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    // Not built yet - show build option
    if (!isBuilt) {
        return (
            <div className="space-y-4">
                {/* Description */}
                <div className="text-center py-4 space-y-2">
                    <div className="text-muted-foreground text-sm">
                        Build a Casino to play European Roulette with true 2.7% house edge!
                    </div>
                </div>

                {/* Build Cost Section */}
                <div className="space-y-4 pt-4 border-t border-border">
                    <div className="space-y-2">
                        <h4 className="font-semibold text-sm">Build Cost:</h4>
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-muted-foreground">Instant Build:</span>
                            <span className="font-semibold">
                                {buildCostDisplay} {displaySymbol}
                            </span>
                        </div>
                        {address && buildingConfig && (
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-muted-foreground">Your Balance:</span>
                                <span className={hasSufficientBalance ? "font-medium" : "font-medium text-destructive"}>
                                    {buildTokenBalance ? formatTokenAmount(buildTokenBalance.value, buildTokenDecimals) : '...'} {displaySymbol}
                                </span>
                            </div>
                        )}
                    </div>

                    <div className="space-y-2">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium">Build Casino</span>
                        </div>

                        {!address || !walletClient ? (
                            <Button className="w-full" variant="secondary" disabled>
                                Connect wallet to build
                            </Button>
                        ) : (buildingConfig && !isBuildBalanceLoaded) ? (
                            <Button className="w-full" variant="secondary" disabled>
                                Checking balance...
                            </Button>
                        ) : (buildingConfig && !hasSufficientBalance) ? (
                            <Button className="w-full" variant="secondary" disabled>
                                Insufficient balance
                            </Button>
                        ) : (!hasApproval && buildingConfig) ? (
                            <ApproveTransaction
                                spenderAddress={LAND_CONTRACT_ADDRESS}
                                tokenAddress={buildingConfig.token as `0x${string}`}
                                onSuccess={onApproveSuccess}
                                buttonText={`Approve ${displaySymbol} to Build`}
                                buttonClassName="w-full"
                            />
                        ) : (
                            <SponsoredTransaction
                                calls={[buildCasinoBuildCall(landId)]}
                                onSuccess={onBuildSuccess}
                                onError={(err) => setError(err.message)}
                                buttonText={`Build (${buildCostDisplay} ${displaySymbol})`}
                                buttonClassName="w-full"
                                disabled={!walletClient || !buildingConfig || !hasApproval || !hasSufficientBalance}
                            />
                        )}
                    </div>

                    {error && (
                        <p className="text-xs text-destructive text-center">{error}</p>
                    )}
                </div>
            </div>
        );
    }

    // Casino is built - show game options
    return (
        <div className="text-center py-4 space-y-2">
            <div className="text-muted-foreground text-sm">
                Play Roulette or Blackjack with fair onchain randomness!
                <div className="mt-2 text-xs text-primary font-medium bg-primary/10 p-2 rounded border border-primary/20 text-left">
                    ⚠️ Info: Active bets expire after 256 blocks (~10 mins). Expired bets are forfeited.
                </div>
            </div>

            {/* Stats summary */}
            {(stats || bjStats) && (
                <div className="flex flex-col gap-1 text-xs text-muted-foreground py-2">
                    {stats && (
                        <div className="flex justify-center gap-4">
                            <span>🎰 Roulette:</span>
                            <span>Games: {stats.games.toString()}</span>
                            <span>Wagered: {formatTokenAmount(stats.wagered, 18)} {displayBettingSymbol}</span>
                            <span>Won: {formatTokenAmount(stats.won, 18)} {displayBettingSymbol}</span>
                        </div>
                    )}
                    {bjStats && process.env.NEXT_PUBLIC_BLACKJACK_ENABLED !== 'false' && (
                        <div className="flex justify-center gap-4">
                            <span>♦️ Blackjack:</span>
                            <span>Games: {bjStats.games.toString()}</span>
                            <span>Wagered: {formatTokenAmount(bjStats.wagered, 18)} {displayBettingSymbol}</span>
                            <span>Won: {formatTokenAmount(bjStats.won, 18)} {displayBettingSymbol}</span>
                        </div>
                    )}
                </div>
            )}

            {/* Game buttons */}
            <div className="pt-2 flex justify-center gap-2">
                <Button className="h-9 px-3 text-sm" onClick={() => setCasinoOpen(true)}>
                    🎰 Play Roulette
                </Button>
                {process.env.NEXT_PUBLIC_BLACKJACK_ENABLED !== 'false' && (
                    <Button
                        className="h-9 px-3 text-sm bg-green-700 hover:bg-green-800"
                        onClick={() => setBlackjackOpen(true)}
                    >
                        ♦️ Play Blackjack
                    </Button>
                )}
            </div>

            <CasinoDialog
                open={casinoOpen}
                onOpenChange={setCasinoOpen}
                landId={landId}
                onSpinComplete={handleSpinComplete}
            />

            <BlackjackDialog
                open={blackjackOpen}
                onOpenChange={setBlackjackOpen}
                landId={landId}
                onGameComplete={handleSpinComplete}
            />
        </div>
    );
}
