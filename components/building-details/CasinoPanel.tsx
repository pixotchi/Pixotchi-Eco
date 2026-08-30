"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, Loader2 } from "lucide-react";
import {
  baccaratGetActiveGame,
  baccaratGetStatsByToken,
  baccaratGetTokenConfig,
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
  checkCasinoApproval,
  LAND_CONTRACT_ADDRESS,
  type BaccaratTokenConfig,
  type BlackjackTokenConfig,
  type CasinoTokenConfig,
} from "@/lib/contracts";
import { formatTokenAmount, getCasinoTokenImage, formatAddress } from "@/lib/utils";
import SponsoredTransaction from "@/components/transactions/sponsored-transaction";
import ApproveTransaction from "@/components/transactions/approve-transaction";
import DisabledTransaction from "@/components/transactions/disabled-transaction";
import CasinoDialog from "@/components/transactions/CasinoDialog";
import BlackjackDialog from "@/components/transactions/BlackjackDialog";
import BaccaratDialog from "@/components/transactions/BaccaratDialog";
import { InlineBalanceNotice } from "@/components/ui/premium";
import { toast } from "react-hot-toast";
import { useWalletClient, useAccount, useBalance } from "wagmi";
import { useTokenMetadata } from "@/hooks/useTokenMetadata";
import { useTokenSymbol } from "@/hooks/useTokenSymbol";
import { getClientCasinoPolicy } from "@/lib/casino-client";

interface CasinoPanelProps {
  landId: bigint;
  initialIsBuilt: boolean;
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
  baccaratConfig: BaccaratTokenConfig | null;
};

const CASINO_GAME_BUTTON_BASE =
  "w-full justify-center border px-3 text-sm shadow-[var(--shadow-hairline)] hover:shadow-[var(--shadow-control)]";
const ROULETTE_BUTTON_CLASS =
  `${CASINO_GAME_BUTTON_BASE} border-rose-300/45 bg-card/92 bg-[image:linear-gradient(180deg,rgba(255,255,255,0.42)_0%,rgba(251,113,133,0.12)_100%)] text-foreground hover:border-rose-300/65 hover:bg-rose-50/70 hover:text-foreground focus-visible:ring-rose-300/45 dark:hover:bg-rose-950/28`;
const BLACKJACK_BUTTON_CLASS =
  `${CASINO_GAME_BUTTON_BASE} border-emerald-300/45 bg-card/92 bg-[image:linear-gradient(180deg,rgba(255,255,255,0.42)_0%,rgba(52,211,153,0.12)_100%)] text-foreground hover:border-emerald-300/65 hover:bg-emerald-50/70 hover:text-foreground focus-visible:ring-emerald-300/45 dark:hover:bg-emerald-950/28`;
const BACCARAT_BUTTON_CLASS =
  `${CASINO_GAME_BUTTON_BASE} border-amber-300/50 bg-card/92 bg-[image:linear-gradient(180deg,rgba(255,255,255,0.42)_0%,rgba(245,158,11,0.13)_100%)] text-foreground hover:border-amber-300/70 hover:bg-amber-50/70 hover:text-foreground focus-visible:ring-amber-300/45 dark:hover:bg-amber-950/28`;

function CasinoTokenLabel({
  tokenAddress,
  selected = false,
}: {
  tokenAddress: string;
  selected?: boolean;
}) {
  const { symbol } = useTokenMetadata(tokenAddress);
  const label = symbol || formatAddress(tokenAddress);

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
      {selected && <span className="text-xs uppercase text-muted-foreground">Selected</span>}
    </div>
  );
}

export default function CasinoPanel({ landId, initialIsBuilt, onSpinComplete }: CasinoPanelProps) {
  const { data: walletClient } = useWalletClient();
  const { address } = useAccount();
  const casinoPolicy = getClientCasinoPolicy();

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

  const [isBuilt, setIsBuilt] = useState(initialIsBuilt);
  const [buildingConfig, setBuildingConfig] = useState<{ token: string; cost: bigint } | null>(null);
  const [supportedTokens, setSupportedTokens] = useState<CasinoGameToken[]>([]);
  const [selectedToken, setSelectedToken] = useState<string | null>(null);
  const [activeRouletteToken, setActiveRouletteToken] = useState<string | null>(null);
  const [activeBlackjackToken, setActiveBlackjackToken] = useState<string | null>(null);
  const [stats, setStats] = useState<TokenStatsRow | null>(null);
  const [bjStats, setBjStats] = useState<TokenStatsRow | null>(null);
  const [baccaratStats, setBaccaratStats] = useState<TokenStatsRow | null>(null);
  const [allowanceWei, setAllowanceWei] = useState(BigInt(0));
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [casinoOpen, setCasinoOpen] = useState(false);
  const [blackjackOpen, setBlackjackOpen] = useState(false);
  const [baccaratOpen, setBaccaratOpen] = useState(false);
  const normalizedAddress = address?.toLowerCase() ?? "disconnected";
  const casinoIdentity = `${landId.toString()}:${normalizedAddress}`;
  const currentCasinoIdentityRef = useRef(casinoIdentity);
  const casinoStateRequestRef = useRef(0);
  const casinoStatsRequestRef = useRef(0);
  const [loadedCasinoIdentity, setLoadedCasinoIdentity] = useState<string | null>(null);
  const [loadedStatsIdentity, setLoadedStatsIdentity] = useState<string | null>(null);
  currentCasinoIdentityRef.current = casinoIdentity;

  const selectedTokenEntry = useMemo(
    () => supportedTokens.find((entry) => entry.address.toLowerCase() === selectedToken?.toLowerCase()) ?? null,
    [selectedToken, supportedTokens]
  );

  const selectedRouletteConfig = selectedTokenEntry?.rouletteConfig ?? null;
  const selectedBlackjackConfig = selectedTokenEntry?.blackjackConfig ?? null;
  const selectedBaccaratConfig = selectedTokenEntry?.baccaratConfig ?? null;
  const activeRouletteEntry = useMemo(
    () => supportedTokens.find((entry) => entry.address.toLowerCase() === activeRouletteToken?.toLowerCase()) ?? null,
    [activeRouletteToken, supportedTokens]
  );
  const activeBlackjackEntry = useMemo(
    () => supportedTokens.find((entry) => entry.address.toLowerCase() === activeBlackjackToken?.toLowerCase()) ?? null,
    [activeBlackjackToken, supportedTokens]
  );
  const [activeBaccaratToken, setActiveBaccaratToken] = useState<string | null>(null);
  const activeBaccaratEntry = useMemo(
    () => supportedTokens.find((entry) => entry.address.toLowerCase() === activeBaccaratToken?.toLowerCase()) ?? null,
    [activeBaccaratToken, supportedTokens]
  );
  const hasActiveRouletteGame = !!activeRouletteToken;
  const hasActiveBlackjackGame = !!activeBlackjackToken;
  const hasActiveBaccaratGame = !!activeBaccaratToken;

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
  const { symbol: activeBaccaratSymbol } = useTokenMetadata(activeBaccaratToken);

  const loadSelectedTokenStats = useCallback(async () => {
    const requestIdentity = casinoIdentity;
    if (currentCasinoIdentityRef.current !== requestIdentity) return;
    const requestId = ++casinoStatsRequestRef.current;
    if (!selectedToken || !isBuilt) {
      setStats(null);
      setBjStats(null);
      setBaccaratStats(null);
      setLoadedStatsIdentity(null);
      return;
    }

    const requestToken = selectedToken;
    const statsIdentity = `${requestIdentity}:${requestToken.toLowerCase()}`;
    try {
      const [rouletteStats, blackjackStats, baccaratStatsResult] = await Promise.all([
        casinoGetStatsByToken(landId, requestToken),
        blackjackGetStatsByToken(landId, requestToken),
        baccaratGetStatsByToken(landId, requestToken),
      ]);
      if (
        requestId !== casinoStatsRequestRef.current
        || currentCasinoIdentityRef.current !== requestIdentity
      ) return;

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

      setBaccaratStats(
        baccaratStatsResult
          ? {
              wagered: baccaratStatsResult.totalWagered,
              won: baccaratStatsResult.totalWon,
              games: baccaratStatsResult.gamesPlayed,
            }
          : null
      );
      setLoadedStatsIdentity(statsIdentity);
    } catch (err) {
      console.error("Failed to load casino token stats:", err);
      if (
        requestId !== casinoStatsRequestRef.current
        || currentCasinoIdentityRef.current !== requestIdentity
      ) return;
      setStats(null);
      setBjStats(null);
      setBaccaratStats(null);
      setLoadedStatsIdentity(statsIdentity);
    }
  }, [casinoIdentity, isBuilt, landId, selectedToken]);

  const loadCasinoState = useCallback(async (knownBuilt = initialIsBuilt) => {
    const requestIdentity = casinoIdentity;
    if (currentCasinoIdentityRef.current !== requestIdentity) return;
    const requestId = ++casinoStateRequestRef.current;
    const requestLandId = landId;
    const requestAddress = address;
    try {
      setIsLoading(true);
      setError(null);

      const [bConfig, tokenAddresses, activeRouletteBet, blackjackSnapshot, activeBaccaratGame] = await Promise.all([
        casinoGetBuildingConfig(),
        casinoGetSupportedTokens(),
        casinoGetActiveBetV2(requestLandId),
        blackjackGetGameSnapshot(requestLandId),
        baccaratGetActiveGame(requestLandId),
      ]);

      const blackjackToken = blackjackSnapshot?.isActive
        ? await blackjackGetGameToken(requestLandId)
        : null;

      const tokenConfigs = await Promise.all(
        tokenAddresses.map(async (tokenAddress) => {
          const [rouletteConfig, blackjackConfig, baccaratConfig] = await Promise.all([
            casinoGetTokenConfig(tokenAddress),
            blackjackGetTokenConfig(tokenAddress),
            baccaratGetTokenConfig(tokenAddress),
          ]);

          return {
            address: tokenAddress,
            rouletteConfig,
            blackjackConfig,
            baccaratConfig,
          } satisfies CasinoGameToken;
        })
      );

      const selectableTokens = tokenConfigs.filter(
        (entry) => entry.rouletteConfig?.supported || entry.blackjackConfig?.supported || entry.baccaratConfig?.supported
      );
      const approval = requestAddress && !knownBuilt && bConfig
        ? await checkCasinoApproval(requestAddress, bConfig.buildingToken)
        : BigInt(0);

      if (
        requestId !== casinoStateRequestRef.current
        || currentCasinoIdentityRef.current !== requestIdentity
      ) return;

      setIsBuilt(knownBuilt);
      setActiveRouletteToken(activeRouletteBet?.isActive ? activeRouletteBet.bettingToken : null);
      setActiveBlackjackToken(blackjackSnapshot?.isActive ? blackjackToken : null);
      setActiveBaccaratToken(activeBaccaratGame?.isActive ? activeBaccaratGame.bettingToken : null);
      setBuildingConfig(bConfig
        ? { token: bConfig.buildingToken, cost: bConfig.buildingCost }
        : null);
      setSupportedTokens(selectableTokens);

      setSelectedToken((current) => {
        if (
          current &&
          selectableTokens.some((entry) => entry.address.toLowerCase() === current.toLowerCase())
        ) {
          return current;
        }

        return selectableTokens.find(
          (entry) => entry.rouletteConfig?.enabled || entry.blackjackConfig?.enabled || entry.baccaratConfig?.enabled
        )?.address
          ?? selectableTokens[0]?.address
          ?? null;
      });
      setAllowanceWei(approval);
      setLoadedCasinoIdentity(requestIdentity);
    } catch (err) {
      console.error("Failed to load casino state:", err);
      if (
        requestId !== casinoStateRequestRef.current
        || currentCasinoIdentityRef.current !== requestIdentity
      ) return;
      setIsBuilt(knownBuilt);
      setBuildingConfig(null);
      setSupportedTokens([]);
      setSelectedToken(null);
      setActiveRouletteToken(null);
      setActiveBlackjackToken(null);
      setActiveBaccaratToken(null);
      setAllowanceWei(BigInt(0));
      setError("Failed to load casino data");
      setLoadedCasinoIdentity(requestIdentity);
    } finally {
      if (
        requestId === casinoStateRequestRef.current
        && currentCasinoIdentityRef.current === requestIdentity
      ) setIsLoading(false);
    }
  }, [address, casinoIdentity, initialIsBuilt, landId]);

  useEffect(() => {
    casinoStateRequestRef.current += 1;
    casinoStatsRequestRef.current += 1;
    setLoadedCasinoIdentity(null);
    setLoadedStatsIdentity(null);
    setIsBuilt(initialIsBuilt);
    setBuildingConfig(null);
    setSupportedTokens([]);
    setSelectedToken(null);
    setActiveRouletteToken(null);
    setActiveBlackjackToken(null);
    setActiveBaccaratToken(null);
    setStats(null);
    setBjStats(null);
    setBaccaratStats(null);
    setAllowanceWei(BigInt(0));
    setError(null);
    setIsLoading(true);
    setCasinoOpen(false);
    setBlackjackOpen(false);
    setBaccaratOpen(false);
    void loadCasinoState(initialIsBuilt);

    return () => {
      casinoStateRequestRef.current += 1;
      casinoStatsRequestRef.current += 1;
    };
  }, [casinoIdentity, initialIsBuilt, loadCasinoState]);

  useEffect(() => {
    void loadSelectedTokenStats();
  }, [loadSelectedTokenStats]);

  const onBuildSuccess = useCallback(async () => {
    toast.success("Casino built successfully!");
    setIsBuilt(true);
    setAllowanceWei(BigInt(0));
    await loadCasinoState(true);
    if (currentCasinoIdentityRef.current !== casinoIdentity) return;
    if (onSpinComplete) onSpinComplete();
  }, [casinoIdentity, loadCasinoState, onSpinComplete]);

  const onApproveSuccess = useCallback(async () => {
    const operationIdentity = casinoIdentity;
    toast.success("Token approved!");
    await refetchBuildTokenBalance();
    if (currentCasinoIdentityRef.current !== operationIdentity) return;
    await loadCasinoState(false);
  }, [casinoIdentity, loadCasinoState, refetchBuildTokenBalance]);

  const handleSpinComplete = useCallback(async () => {
    const operationIdentity = casinoIdentity;
    await loadCasinoState(isBuilt);
    if (currentCasinoIdentityRef.current !== operationIdentity) return;
    await loadSelectedTokenStats();
    if (currentCasinoIdentityRef.current !== operationIdentity) return;
    if (onSpinComplete) onSpinComplete();
  }, [casinoIdentity, isBuilt, loadCasinoState, loadSelectedTokenStats, onSpinComplete]);

  const handleOpenCasinoGame = useCallback((game: "roulette" | "blackjack" | "baccarat") => {
    if (!casinoPolicy.playable) {
      toast.error(casinoPolicy.message || "Casino is currently unavailable.");
      return;
    }

    if (game === "roulette") {
      setCasinoOpen(true);
      return;
    }

    if (game === "blackjack") {
      setBlackjackOpen(true);
      return;
    }

    setBaccaratOpen(true);
  }, [casinoPolicy.message, casinoPolicy.playable]);

  const blackjackDisabledForToken =
    !casinoPolicy.blackjackEnabled ||
    !selectedBlackjackConfig?.supported ||
    !selectedBlackjackConfig.enabled;

  const rouletteDisabledForToken = !selectedRouletteConfig?.supported || !selectedRouletteConfig.enabled;
  const baccaratDisabledForToken = !selectedBaccaratConfig?.supported || !selectedBaccaratConfig.enabled;
  const rouletteButtonDisabled =
    casinoPolicy.playable &&
    !hasActiveRouletteGame &&
    (!selectedToken || rouletteDisabledForToken);
  const blackjackButtonDisabled =
    casinoPolicy.playable &&
    !hasActiveBlackjackGame &&
    (!selectedToken || blackjackDisabledForToken);
  const baccaratButtonDisabled =
    casinoPolicy.playable &&
    !hasActiveBaccaratGame &&
    (!selectedToken || baccaratDisabledForToken);
  const expectedStatsIdentity = selectedToken && isBuilt
    ? `${casinoIdentity}:${selectedToken.toLowerCase()}`
    : null;
  const statsAreCurrent = expectedStatsIdentity !== null && loadedStatsIdentity === expectedStatsIdentity;
  const currentStats = statsAreCurrent ? stats : null;
  const currentBlackjackStats = statsAreCurrent ? bjStats : null;
  const currentBaccaratStats = statsAreCurrent ? baccaratStats : null;

  if (
    loadedCasinoIdentity !== casinoIdentity
    || (isLoading && !buildingConfig && supportedTokens.length === 0)
  ) {
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
              <>
                <DisabledTransaction buttonText={`Insufficient ${buildTokenSymbol} Balance`} buttonClassName="w-full" />
                <InlineBalanceNotice>
                  Not enough {buildTokenSymbol}. Balance: {buildTokenBalance ? formatTokenAmount(buildTokenBalance.value, buildTokenDecimals) : "..."} • Required: {buildCostDisplay}
                </InlineBalanceNotice>
              </>
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
                intentKey={`casino:build:${landId}`}
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
        Roulette and Baccarat use block reveal; Blackjack uses verified signed randomness.
        <div className="mt-2 text-xs text-primary font-medium bg-primary/10 p-2 rounded border border-primary/20 text-left">
          Active bets expire after 256 blocks (~10 mins). Expired bets are forfeited.
        </div>
      </div>

      {supportedTokens.length > 0 ? (
        <div className="space-y-2 pt-1">
          <div className="text-xs font-semibold uppercase tracking-normal text-muted-foreground">Betting Token</div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className="mx-auto flex h-11 min-h-11 min-w-[220px] justify-between gap-3"
                disabled={supportedTokens.length === 0}
                aria-label="Select casino betting token"
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

      {(currentStats || currentBlackjackStats || currentBaccaratStats) && selectedToken && (
        <div className="flex flex-col gap-1 text-xs text-muted-foreground py-1">
          {currentStats && (
            <div className="flex flex-wrap justify-center gap-3">
              <span>Roulette</span>
              <span>Games: {currentStats.games.toString()}</span>
              <span>Wagered: {formatTokenAmount(currentStats.wagered, selectedTokenDecimals)}</span>
              <span>Won: {formatTokenAmount(currentStats.won, selectedTokenDecimals)}</span>
            </div>
          )}
          {casinoPolicy.blackjackEnabled && currentBlackjackStats && (
            <div className="flex flex-wrap justify-center gap-3">
              <span>Blackjack</span>
              <span>Games: {currentBlackjackStats.games.toString()}</span>
              <span>Wagered: {formatTokenAmount(currentBlackjackStats.wagered, selectedTokenDecimals)}</span>
              <span>Won: {formatTokenAmount(currentBlackjackStats.won, selectedTokenDecimals)}</span>
            </div>
          )}
          {currentBaccaratStats && (
            <div className="flex flex-wrap justify-center gap-3">
              <span>Baccarat</span>
              <span>Games: {currentBaccaratStats.games.toString()}</span>
              <span>Wagered: {formatTokenAmount(currentBaccaratStats.wagered, selectedTokenDecimals)}</span>
              <span>Won: {formatTokenAmount(currentBaccaratStats.won, selectedTokenDecimals)}</span>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2 pt-2">
        <Button
          className={ROULETTE_BUTTON_CLASS}
          onClick={() => handleOpenCasinoGame("roulette")}
          disabled={rouletteButtonDisabled}
          aria-label={hasActiveRouletteGame ? "Resume Roulette game" : "Play Roulette"}
          leadingIcon={<span className="text-base leading-none" aria-hidden="true">🎰</span>}
        >
          {hasActiveRouletteGame ? "Resume Roulette" : "Play Roulette"}
        </Button>
        {casinoPolicy.blackjackEnabled && (
          <Button
            className={BLACKJACK_BUTTON_CLASS}
            onClick={() => handleOpenCasinoGame("blackjack")}
            disabled={blackjackButtonDisabled}
            aria-label={hasActiveBlackjackGame ? "Resume Blackjack game" : "Play Blackjack"}
            leadingIcon={<span className="text-base leading-none" aria-hidden="true">♦️</span>}
          >
            {hasActiveBlackjackGame ? "Resume Blackjack" : "Play Blackjack"}
          </Button>
        )}
        <Button
          className={BACCARAT_BUTTON_CLASS}
          onClick={() => handleOpenCasinoGame("baccarat")}
          disabled={baccaratButtonDisabled}
          aria-label={hasActiveBaccaratGame ? "Resume Baccarat game" : "Play Baccarat"}
          leadingIcon={<span className="text-base leading-none" aria-hidden="true">♣</span>}
        >
          {hasActiveBaccaratGame ? "Resume Baccarat" : "Play Baccarat"}
        </Button>
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

      {hasActiveBaccaratGame && (
        <p className="text-xs text-muted-foreground">
          Active Baccarat round locked to {activeBaccaratSymbol || activeBaccaratEntry?.address.slice(0, 6)} until revealed.
        </p>
      )}

      {!hasActiveRouletteGame && selectedToken && rouletteDisabledForToken && (
        <p className="text-xs text-muted-foreground">
          Roulette is not enabled for the selected token.
        </p>
      )}

      {!hasActiveBlackjackGame && selectedToken && blackjackDisabledForToken && casinoPolicy.blackjackEnabled && (
        <p className="text-xs text-muted-foreground">
          Blackjack is not enabled for the selected token.
        </p>
      )}

      {!hasActiveBaccaratGame && selectedToken && baccaratDisabledForToken && (
        <p className="text-xs text-muted-foreground">
          Baccarat is not enabled for the selected token.
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

      <BaccaratDialog
        open={baccaratOpen}
        onOpenChange={setBaccaratOpen}
        landId={landId}
        onGameComplete={handleSpinComplete}
        selectedToken={selectedToken}
      />
    </div>
  );
}
