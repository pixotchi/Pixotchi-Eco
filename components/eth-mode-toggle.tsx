"use client";

import { useEthMode } from "@/lib/eth-mode-context";
import { Switch } from "@/components/ui/switch";
import { Coins } from "lucide-react";

/**
 * ETH Mode Toggle Component
 * 
 * Allows smart wallet users to enable "Pay with ETH" mode,
 * which automatically swaps ETH to SEED for all in-game actions.
 * 
 * Only visible when user has a smart wallet.
 */
export function EthModeToggle() {
    const { isEthModeEnabled, toggleEthMode, canUseEthMode, isLoading } = useEthMode();

    // Don't render if user can't use ETH Mode (not a smart wallet)
    if (!canUseEthMode) {
        return null;
    }

    return (
        <div className="flex items-center justify-between py-2">
            <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center">
                    <Coins className="w-4 h-4 text-primary" />
                </div>
                <div className="flex flex-col">
                    <span className="text-sm font-medium">Pay with ETH</span>
                    <span className="text-xs text-muted-foreground">
                        Auto-swap ETH to SEED for purchases
                    </span>
                </div>
            </div>
            <Switch
                checked={isEthModeEnabled}
                onCheckedChange={toggleEthMode}
                disabled={isLoading}
                aria-label="Toggle ETH payment mode"
            />
        </div>
    );
}

export default EthModeToggle;
