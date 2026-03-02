"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Loader2, ChevronDown } from "lucide-react";
import {
  blackjackGetGameSnapshot,
  blackjackGetGameToken,
  blackjackGetStatsByToken,
  blackjackGetTokenConfig,
  buildCasinoBuildCall,
  casinoGetActiveBetV2,
  casinoGetBuildingConfig,
  casinoGetStatsByToken,
  casinoGetSupportedTokens,
  casinoGetTokenConfig,
  casinoIsBuilt,
  checkCasinoApproval,
  LAND_CONTRACT_ADDRESS,
  type BlackjackTokenConfig,
  type CasinoTokenConfig,
} from "@/lib/contracts";
import { formatTokenAmount, getCasinoTokenImage } from "@/lib/utils";
import SponsoredTransaction from "@/components/transactions/sponsored-transaction";
import ApproveTransaction from "@/components/transactions/approve-transaction";
import CasinoDialog from "@/components/transactions/CasinoDialog";
import BlackjackDialog from "@/components/transactions/BlackjackDialog";
import { toast } from "react-hot-toast";
import { useWalletClient, useAccount, useBalance } from "wagmi";
import { useTokenMetadata } from "@/hooks/useTokenMetadata";
import { useTokenSymbol } from "@/hooks/useTokenSymbol";

interface CasinoPanelProps {
  landId: bigint;
  onSpinComplete?: () => void;
}

type TokenStatsRow = {
  wagered: bigint;
  won: bigint;
  games: bigint;
};

type CasinoGameToken = {
  address: string;
  rouletteConfig: CasinoTokenConfig | null;
  blackjackConfig: BlackjackTokenConfig | null;
};

function CasinoTokenLabel({
  tokenAddress,
  selected = false,
}: {
  tokenAddress: string;
  selected?: boolean;
}) {
  const { symbol } = useTokenMetadata(tokenAddress);
  const label = symbol || `${tokenAddress.slice(0, 6)}...${tokenAddress.slice(-4)}`;

  return (
    <div className="flex min-w-0 items-center gap-2">
      <Image
        src={getCasinoTokenImage(tokenAddress)}
        alt={label}
        width={20}
        height={20}
        className="h-5 w-5 rounded-full"
      />
      <span className="truncate text-sm font-medium">{label}</span>
      {selected && <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Selected</span>}
    </div>
  );
}

export default function CasinoPanel({ landId, onSpinComplete }: CasinoPanelProps) {
  const { data: walletClient } = useWalletClient();
  const { address } = useAccount();

  const formatWholeNumber = useCallback((num: bigint): string => {
    const text = num.toString();
    return text.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }, []);

  const formatBuildCostRounded = useCallback((amount: bigint, decimals: number): string => {
    if (amount <= BigInt(0)) return "0";
    const divisor = BigInt(10) ** BigInt(decimals);
    const roundedWhole = (amount + (divisor / BigInt(2))) / divisor;
    return formatWholeNumber(roundedWhole);
  }, [formatWholeNumber]);

  const [isBuilt, setIsBuilt] = useState<boolean | null>(null);
  const [buildingConfig, setBuildingConfig] = useState<{ token: string; cost: bigint } | null>(null);
  const [supportedTokens, setSupportedTokens] = useState<CasinoGameToken[]>([]);
  const [selectedToken, setSelectedToken] = useState<string | null>(null);
  const [activeRouletteToken, setActiveRouletteToken] = useState<string | null>(null);
  const [activeBlackjackToken, setActiveBlackjackToken] = useState<string | null>(null);
  const [stats, setStats] = useState<TokenStatsRow | null>(null);
  const [bjStats, setBjStats] = useState<TokenStatsRow | null>(null);
  const [allowanceWei, setAllowanceWei] = useState(BigInt(0));
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [casinoOpen, setCasinoOpen] = useState(false);
  const [blackjackOpen, setBlackjackOpen] = useState(false);

  const selectedTokenEntry = useMemo(
    () => supportedTokens.find((entry) => entry.address.toLowerCase() === selectedToken?.toLowerCase()) ?? null,
    [selectedToken, supportedTokens]
  );

  const selectedRouletteConfig = selectedTokenEntry?.rouletteConfig ?? null;
  const selectedBlackjackConfig = selectedTokenEntry?.blackjackConfig ?? null;
  const activeRouletteEntry = useMemo(
    () => supportedTokens.find((entry) => entry.address.toLowerCase() === activeRouletteToken?.toLowerCase()) ?? null,
    [activeRouletteToken, supportedTokens]
  );
  const activeBlackjackEntry = useMemo(
    () => supportedTokens.find((entry) => entry.address.toLowerCase() === activeBlackjackToken?.toLowerCase()) ?? null,
    [activeBlackjackToken, supportedTokens]
  );
  const hasActiveRouletteGame = !!activeRouletteToken;
  const hasActiveBlackjackGame = !!activeBlackjackToken;

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
    : "...";

  const buildTokenSymbol = useTokenSymbol(buildingConfig?.token) || "SEED";
  const {
    decimals: selectedTokenDecimals,
  } = useTokenMetadata(selectedToken);
  const { symbol: activeRouletteSymbol } = useTokenMetadata(activeRouletteToken);
  const { symbol: activeBlackjackSymbol } = useTokenMetadata(activeBlackjackToken);

  const loadSelectedTokenStats = useCallback(async () => {
    if (!selectedToken || !isBuilt) {
      setStats(null);
      setBjStats(null);
      return;
    }

    try {
      const [rouletteStats, blackjackStats] = await Promise.all([
        casinoGetStatsByToken(landId, selectedToken),
        blackjackGetStatsByToken(landId, selectedToken),
      ]);

      setStats(
        rouletteStats
          ? {
              wagered: rouletteStats.totalWagered,
              won: rouletteStats.totalWon,
              games: rouletteStats.gamesPlayed,
            }
          : null
      );

      setBjStats(
        blackjackStats
          ? {
              wagered: blackjackStats.totalWagered,
              won: blackjackStats.totalWon,
              games: blackjackStats.gamesPlayed,
            }
          : null
      );
    } catch (err) {
      console.error("Failed to load casino token stats:", err);
      setStats(null);
      setBjStats(null);
    }
  }, [isBuilt, landId, selectedToken]);

  const loadCasinoState = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const [built, bConfig, tokenAddresses, activeRouletteBet, blackjackSnapshot] = await Promise.all([
        casinoIsBuilt(landId),
        casinoGetBuildingConfig(),
        casinoGetSupportedTokens(),
        casinoGetActiveBetV2(landId),
        blackjackGetGameSnapshot(landId),
      ]);

      const blackjackToken = blackjackSnapshot?.isActive
        ? await blackjackGetGameToken(landId)
        : null;

      setIsBuilt(built);
      setActiveRouletteToken(activeRouletteBet?.isActive ? activeRouletteBet.bettingToken : null);
      setActiveBlackjackToken(blackjackSnapshot?.isActive ? blackjackToken : null);

      if (bConfig) {
        setBuildingConfig({ token: bConfig.buildingToken, cost: bConfig.buildingCost });
      }

      const tokenConfigs = await Promise.all(
        tokenAddresses.map(async (tokenAddress) => {
          const [rouletteConfig, blackjackConfig] = await Promise.all([
            casinoGetTokenConfig(tokenAddress),
            blackjackGetTokenConfig(tokenAddress),
          ]);

          return {
            address: tokenAddress,
            rouletteConfig,
            blackjackConfig,
          } satisfies CasinoGameToken;
        })
      );

      const selectableTokens = tokenConfigs.filter(
        (entry) => entry.rouletteConfig?.supported || entry.blackjackConfig?.supported
      );
      setSupportedTokens(selectableTokens);

      setSelectedToken((current) => {
        if (
          current &&
          selectableTokens.some((entry) => entry.address.toLowerCase() === current.toLowerCase())
        ) {
          return current;
        }

        return selectableTokens.find(
          (entry) => entry.rouletteConfig?.enabled || entry.blackjackConfig?.enabled
        )?.address
          ?? selectableTokens[0]?.address
          ?? null;
      });

      if (address && !built && bConfig) {
        const approval = await checkCasinoApproval(address, bConfig.buildingToken);
        setAllowanceWei(approval);
      } else {
        setAllowanceWei(BigInt(0));
      }
    } catch (err) {
      console.error("Failed to load casino state:", err);
      setError("Failed to load casino data");
    } finally {
      setIsLoading(false);
    }
  }, [address, landId]);

  useEffect(() => {
    loadCasinoState();
  }, [loadCasinoState]);

  useEffect(() => {
    loadSelectedTokenStats();
  }, [loadSelectedTokenStats]);

  const onBuildSuccess = useCallback(async () => {
    toast.success("Casino built successfully!");
    await loadCasinoState();
    if (onSpinComplete) onSpinComplete();
  }, [loadCasinoState, onSpinComplete]);

  const onApproveSuccess = useCallback(async () => {
    toast.success("Token approved!");
    await refetchBuildTokenBalance();
    if (address && buildingConfig) {
      const approval = await checkCasinoApproval(address, buildingConfig.token);
      setAllowanceWei(approval);
    }
  }, [address, buildingConfig, refetchBuildTokenBalance]);

  const handleSpinComplete = useCallback(async () => {
    await Promise.all([loadCasinoState(), loadSelectedTokenStats()]);
    if (onSpinComplete) onSpinComplete();
  }, [loadCasinoState, loadSelectedTokenStats, onSpinComplete]);

  const blackjackDisabledForToken =
    process.env.NEXT_PUBLIC_BLACKJACK_ENABLED === "false" ||
    !selectedBlackjackConfig?.supported ||
    !selectedBlackjackConfig.enabled;

  const rouletteDisabledForToken = !selectedRouletteConfig?.supported || !selectedRouletteConfig.enabled;
  const rouletteButtonDisabled = !hasActiveRouletteGame && (!selectedToken || rouletteDisabledForToken);
  const blackjackButtonDisabled =
    !hasActiveBlackjackGame &&
    (!selectedToken || blackjackDisabledForToken);

  if (isLoading && isBuilt === null) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isBuilt) {
    return (
      <div className="space-y-4">
        <div className="text-center py-4 space-y-2">
          <div className="text-muted-foreground text-sm">
            Build a Casino to play European Roulette with true 2.7% house edge!
          </div>
        </div>

        <div className="space-y-4 pt-4 border-t border-border">
          <div className="space-y-2">
            <h4 className="font-semibold text-sm">Build Cost:</h4>
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">Instant Build:</span>
              <span className="font-semibold">
                {buildCostDisplay} {buildTokenSymbol}
              </span>
            </div>
            {address && buildingConfig && (
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Your Balance:</span>
                <span className={hasSufficientBalance ? "font-medium" : "font-medium text-destructive"}>
                  {buildTokenBalance ? formatTokenAmount(buildTokenBalance.value, buildTokenDecimals) : "..."} {buildTokenSymbol}
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
            ) : buildingConfig && !isBuildBalanceLoaded ? (
              <Button className="w-full" variant="secondary" disabled>
                Checking balance...
              </Button>
            ) : buildingConfig && !hasSufficientBalance ? (
              <Button className="w-full" variant="secondary" disabled>
                Insufficient balance
              </Button>
            ) : !hasApproval && buildingConfig ? (
              <ApproveTransaction
                spenderAddress={LAND_CONTRACT_ADDRESS}
                tokenAddress={buildingConfig.token as `0x${string}`}
                onSuccess={onApproveSuccess}
                buttonText={`Approve ${buildTokenSymbol} to Build`}
                buttonClassName="w-full"
              />
            ) : (
              <SponsoredTransaction
                calls={[buildCasinoBuildCall(landId)]}
                onSuccess={onBuildSuccess}
                onError={(err) => setError(err.message)}
                buttonText={`Build (${buildCostDisplay} ${buildTokenSymbol})`}
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

  return (
    <div className="text-center py-4 space-y-3">
      <div className="text-muted-foreground text-sm">
        Play Roulette or Blackjack with fair onchain randomness!
        <div className="mt-2 text-xs text-primary font-medium bg-primary/10 p-2 rounded border border-primary/20 text-left">
          Active bets expire after 256 blocks (~10 mins). Expired bets are forfeited.
        </div>
      </div>

      {supportedTokens.length > 0 ? (
        <div className="space-y-2 pt-1">
          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Betting Token</div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className="mx-auto flex h-10 min-w-[220px] justify-between gap-3"
                disabled={supportedTokens.length === 0}
              >
                {selectedToken ? (
                  <CasinoTokenLabel tokenAddress={selectedToken} />
                ) : (
                  <span>Select token</span>
                )}
                <ChevronDown className="h-4 w-4 shrink-0" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width]">
              {supportedTokens.map((entry) => (
                <DropdownMenuItem
                  key={entry.address}
                  onSelect={() => setSelectedToken(entry.address)}
                >
                  <CasinoTokenLabel
                    tokenAddress={entry.address}
                    selected={entry.address.toLowerCase() === selectedToken?.toLowerCase()}
                  />
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : (
        <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          No casino tokens are configured yet.
        </div>
      )}

      {(stats || bjStats) && selectedToken && (
        <div className="flex flex-col gap-1 text-xs text-muted-foreground py-1">
          {stats && (
            <div className="flex flex-wrap justify-center gap-3">
              <span>Roulette</span>
              <span>Games: {stats.games.toString()}</span>
              <span>Wagered: {formatTokenAmount(stats.wagered, selectedTokenDecimals)}</span>
              <span>Won: {formatTokenAmount(stats.won, selectedTokenDecimals)}</span>
            </div>
          )}
          {process.env.NEXT_PUBLIC_BLACKJACK_ENABLED !== "false" && bjStats && (
            <div className="flex flex-wrap justify-center gap-3">
              <span>Blackjack</span>
              <span>Games: {bjStats.games.toString()}</span>
              <span>Wagered: {formatTokenAmount(bjStats.wagered, selectedTokenDecimals)}</span>
              <span>Won: {formatTokenAmount(bjStats.won, selectedTokenDecimals)}</span>
            </div>
          )}
        </div>
      )}

      <div className="pt-2 flex justify-center gap-2">
        <Button
          className="h-9 px-3 text-sm"
          onClick={() => setCasinoOpen(true)}
          disabled={rouletteButtonDisabled}
        >
          {hasActiveRouletteGame ? "🎰 Resume Roulette" : "🎰 Play Roulette"}
        </Button>
        {process.env.NEXT_PUBLIC_BLACKJACK_ENABLED !== "false" && (
          <Button
            className="h-9 px-3 text-sm bg-green-700 hover:bg-green-800"
            onClick={() => setBlackjackOpen(true)}
            disabled={blackjackButtonDisabled}
          >
            {hasActiveBlackjackGame ? "♦️ Resume Blackjack" : "♦️ Play Blackjack"}
          </Button>
        )}
      </div>

      {hasActiveRouletteGame && (
        <p className="text-xs text-muted-foreground">
          Active Roulette game locked to {activeRouletteSymbol || activeRouletteEntry?.address.slice(0, 6)} until revealed.
        </p>
      )}

      {hasActiveBlackjackGame && (
        <p className="text-xs text-muted-foreground">
          Active Blackjack game locked to {activeBlackjackSymbol || activeBlackjackEntry?.address.slice(0, 6)} until resolved.
        </p>
      )}

      {!hasActiveRouletteGame && selectedToken && rouletteDisabledForToken && (
        <p className="text-xs text-muted-foreground">
          Roulette is not enabled for the selected token.
        </p>
      )}

      {!hasActiveBlackjackGame && selectedToken && blackjackDisabledForToken && process.env.NEXT_PUBLIC_BLACKJACK_ENABLED !== "false" && (
        <p className="text-xs text-muted-foreground">
          Blackjack is not enabled for the selected token.
        </p>
      )}

      <CasinoDialog
        open={casinoOpen}
        onOpenChange={setCasinoOpen}
        landId={landId}
        onSpinComplete={handleSpinComplete}
        selectedToken={selectedToken}
      />

      <BlackjackDialog
        open={blackjackOpen}
        onOpenChange={setBlackjackOpen}
        landId={landId}
        onGameComplete={handleSpinComplete}
        selectedToken={selectedToken}
      />
    </div>
  );
}
