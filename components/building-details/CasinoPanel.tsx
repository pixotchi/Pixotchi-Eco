"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { formatUnits } from 'viem';
import {
    casinoIsBuilt,
    casinoGetBuildingConfig,
    casinoGetStats,
    buildCasinoBuildCall,
    checkCasinoApproval,
    LAND_CONTRACT_ADDRESS,
    PIXOTCHI_TOKEN_ADDRESS
} from '@/lib/contracts';
import { formatTokenAmount } from '@/lib/utils';
import SponsoredTransaction from '@/components/transactions/sponsored-transaction';
import ApproveTransaction from '@/components/transactions/approve-transaction';
import CasinoDialog from '@/components/transactions/CasinoDialog';
import { toast } from 'react-hot-toast';
import { useWalletClient, useAccount } from 'wagmi';
import { useTokenSymbol } from '@/hooks/useTokenSymbol';

interface CasinoPanelProps {
    landId: bigint;
    onSpinComplete?: () => void;
}

export default function CasinoPanel({ landId, onSpinComplete }: CasinoPanelProps) {
    const { data: walletClient } = useWalletClient();
    const { address } = useAccount();

    // State
    const [isBuilt, setIsBuilt] = useState<boolean | null>(null);
    const [buildingConfig, setBuildingConfig] = useState<{ token: string; cost: bigint } | null>(null);
    const [stats, setStats] = useState<{ wagered: bigint; won: bigint; games: bigint } | null>(null);

    // Approval state
    const [hasApproval, setHasApproval] = useState(false);

    // UI State
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [casinoOpen, setCasinoOpen] = useState(false);

    // Load casino state
    const loadCasinoState = useCallback(async () => {
        try {
            setIsLoading(true);
            setError(null);

            const [built, bConfig, casinoStats] = await Promise.all([
                casinoIsBuilt(landId),
                casinoGetBuildingConfig(),
                casinoGetStats(landId)
            ]);

            setIsBuilt(built);
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

            // Check approval
            if (address && !built) {
                const approval = await checkCasinoApproval(address, tokenAddress as `0x${string}`);
                // We need to check if approval >= cost
                const required = bConfig ? bConfig.buildingCost : BigInt(0);
                setHasApproval(approval >= required);
            } else {
                setHasApproval(true); // Default to true if already built or no address
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

    // Handle successful build
    const onBuildSuccess = useCallback(async () => {
        toast.success("Casino built successfully!");
        await loadCasinoState();
        if (onSpinComplete) onSpinComplete();
    }, [loadCasinoState, onSpinComplete]);

    // Handle approval success
    const onApproveSuccess = useCallback(async () => {
        toast.success("Token approved!");
        // Re-check approval
        if (address && buildingConfig) {
            const approval = await checkCasinoApproval(address, buildingConfig.token);
            setHasApproval(approval >= buildingConfig.cost);
        }
    }, [address, buildingConfig]);

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
                                {buildingConfig ? formatTokenAmount(buildingConfig.cost, 18) : '...'} {displaySymbol}
                            </span>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium">Build Casino</span>
                        </div>

                        {!hasApproval && buildingConfig ? (
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
                                buttonText={`Build (${buildingConfig ? formatTokenAmount(buildingConfig.cost, 18) : '...'} ${displaySymbol})`}
                                buttonClassName="w-full"
                                disabled={!walletClient || !buildingConfig || !hasApproval}
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

    // Casino is built - show simple panel with "Open Casino" button (like MarketplacePanel)
    return (
        <div className="text-center py-4 space-y-2">
            <div className="text-muted-foreground text-sm">
                Your casino is ready! Play European Roulette with true 2.7% house edge.
                <div className="mt-2 text-xs text-primary font-medium bg-primary/10 p-2 rounded border border-primary/20 text-left">
                    ⚠️ Info: Active bets expire after 256 blocks (~10 mins). Expired bets are forfeited.
                </div>
            </div>

            {/* Stats summary */}
            {stats && (
                <div className="flex justify-center gap-4 text-xs text-muted-foreground py-2">
                    <span>Games: {stats.games.toString()}</span>
                    <span>Wagered: {formatTokenAmount(stats.wagered, 18)} {displaySymbol}</span>
                    <span>Won: {formatTokenAmount(stats.won, 18)} {displaySymbol}</span>
                </div>
            )}

            <div className="pt-2">
                <Button className="h-9 px-3 text-sm" onClick={() => setCasinoOpen(true)}>
                    🎰 Open Casino
                </Button>
            </div>

            <CasinoDialog
                open={casinoOpen}
                onOpenChange={setCasinoOpen}
                landId={landId}
                onSpinComplete={handleSpinComplete}
            />
        </div>
    );
}
