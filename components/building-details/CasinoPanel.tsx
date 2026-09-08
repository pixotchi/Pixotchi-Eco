"use client";

import { formatUpgradeDuration } from '@/lib/utils';
import { BACCARAT_REVEAL_WINDOW_BLOCKS } from '@/lib/casino-reveal-window';
import { TokenAmount } from '@/components/ui/token-amount';

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";
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
import GameTransaction from "@/components/transactions/game-transaction";
import ApproveTransaction from "@/components/transactions/approve-transaction";
import { useBuildingApproval } from '@/hooks/useBuildingApproval';
import CasinoDialog from "@/components/transactions/CasinoDialog";
import BlackjackDialog from "@/components/transactions/BlackjackDialog";
import BaccaratDialog from "@/components/transactions/BaccaratDialog";
import { PurchaseReadinessNotice } from './purchase-readiness-notice';
import { getBuildingPurchaseReadiness } from '@/lib/building-purchase-readiness';
import { formatTokenCost, formatTokenSymbol } from '@/lib/token-display';
import { toast } from "react-hot-toast";
import { useWalletClient, useAccount, useBalance } from "wagmi";
import { useTokenMetadata } from "@/hooks/useTokenMetadata";
import { ResourceState } from '@/components/ui/resource-state';
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
  const label = formatTokenSymbol(symbol) || formatAddress(tokenAddress);

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

  const [isBuilt, setIsBuilt] = useState(initialIsBuilt);
  const [buildingConfig, setBuildingConfig] = useState<{ token: string; cost: bigint } | null>(null);
  const [supportedTokens, setSupportedTokens] = useState<CasinoGameToken[]>([]);
  const [selectedToken, setSelectedToken] = useState<string | null>(null);
  const [activeRouletteToken, setActiveRouletteToken] = useState<string | null>(null);
  const [activeBlackjackToken, setActiveBlackjackToken] = useState<string | null>(null);
  const [stats, setStats] = useState<TokenStatsRow | null>(null);
  const [bjStats, setBjStats] = useState<TokenStatsRow | null>(null);
  const [baccaratStats, setBaccaratStats] = useState<TokenStatsRow | null>(null);
  const [allowanceWei, setAllowanceWei] = useState<bigint>();
  const [allowanceError, setAllowanceError] = useState(false);
  const [configurationReady, setConfigurationReady] = useState(false);
  const [roundStatus, setRoundStatus] = useState<Record<'roulette' | 'blackjack' | 'baccarat', 'loading' | 'ready' | 'error'>>({ roulette: 'loading', blackjack: 'loading', baccarat: 'loading' });
  const [statsError, setStatsError] = useState(false);
  const [statsLoading, setStatsLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [casinoOpen, setCasinoOpen] = useState(false);
  const [blackjackOpen, setBlackjackOpen] = useState(false);
  const [baccaratOpen, setBaccaratOpen] = useState(false);
  const normalizedAddress = address?.toLowerCase() ?? "disconnected";
  const casinoIdentity = `${landId.toString()}:${normalizedAddress}`;
  const approval = useBuildingApproval(casinoIdentity);
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
  const [activeBaccaratToken, setActiveBaccaratToken] = useState<string | null>(null);
  const hasActiveRouletteGame = !!activeRouletteToken;
  const hasActiveBlackjackGame = !!activeBlackjackToken;
  const hasActiveBaccaratGame = !!activeBaccaratToken;

  const { data: buildTokenBalance, isError: buildBalanceError, refetch: refetchBuildTokenBalance } = useBalance({
    address,
    token: buildingConfig?.token as `0x${string}` | undefined,
    query: {
      enabled: !!address && !!buildingConfig && !isBuilt,
    },
  });

  const buildTokenMetadata = useTokenMetadata(buildingConfig?.token);
  const buildTokenSymbol = formatTokenSymbol(buildTokenMetadata.symbol);
  const formatBuildAmount = (amount: bigint) => buildTokenMetadata.isReady && buildTokenMetadata.decimals !== undefined
    ? formatTokenCost(amount, buildTokenMetadata.decimals) : '—';
  const buildCostWei = buildingConfig?.cost ?? BigInt(0);
  const buildReadiness = getBuildingPurchaseReadiness({ cost: buildCostWei, balance: buildTokenBalance?.value,
    balanceError: buildBalanceError, allowance: allowanceWei, allowanceError });
  const buildCostDisplay = buildingConfig && buildTokenMetadata.isReady && buildTokenMetadata.decimals !== undefined
    ? formatBuildAmount(buildingConfig.cost)
    : "...";

  const selectedTokenMetadata = useTokenMetadata(selectedToken);
  const formatSelectedAmount = (amount: bigint) => selectedTokenMetadata.isReady && selectedTokenMetadata.decimals !== undefined
    ? formatTokenAmount(amount, selectedTokenMetadata.decimals) : '—';
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
    setStatsError(false);
    setStatsLoading(true);
    try {
      const [rouletteStats, blackjackStats, baccaratStatsResult] = await Promise.all([
        casinoGetStatsByToken(landId, requestToken),
        blackjackGetStatsByToken(landId, requestToken),
        baccaratGetStatsByToken(landId, requestToken),
      ]);
      if (!rouletteStats || !blackjackStats || !baccaratStatsResult) throw new Error('Casino statistics unavailable');
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
      setStatsError(true);
    } finally {
      if (requestId === casinoStatsRequestRef.current && currentCasinoIdentityRef.current === requestIdentity) setStatsLoading(false);
    }
  }, [casinoIdentity, isBuilt, landId, selectedToken]);

  const loadCasinoState = useCallback(async (knownBuilt = initialIsBuilt) => {
    const requestIdentity = casinoIdentity;
    if (currentCasinoIdentityRef.current !== requestIdentity) return;
    const requestId = ++casinoStateRequestRef.current;
    const requestLandId = landId;
    const requestAddress = address;
    const isCurrent = () => requestId === casinoStateRequestRef.current && currentCasinoIdentityRef.current === requestIdentity;
    setIsLoading(true);
    setIsBuilt(knownBuilt);
    setError(null);
    setConfigurationReady(false);
    setAllowanceError(false);
    setRoundStatus({ roulette: 'loading', blackjack: 'loading', baccarat: 'loading' });

    // Publish each paid round independently. A token-list or sibling-game outage must not erase recovery.
    const readRound = async (game: 'roulette' | 'blackjack' | 'baccarat', read: () => Promise<string | null>, publish: (token: string | null) => void) => {
      try {
        const token = await read();
        if (!isCurrent()) return;
        publish(token);
        setRoundStatus(previous => ({ ...previous, [game]: 'ready' }));
      } catch {
        if (!isCurrent()) return;
        setRoundStatus(previous => ({ ...previous, [game]: 'error' }));
      } finally {
        if (isCurrent() && knownBuilt) setLoadedCasinoIdentity(requestIdentity);
      }
    };
    const readConfiguration = async () => {
      try {
        if (!knownBuilt) {
          const bConfig = await casinoGetBuildingConfig();
          if (!bConfig) throw new Error('Build configuration unavailable');
          if (!isCurrent()) return;
          setBuildingConfig({ token: bConfig.buildingToken, cost: bConfig.buildingCost });
          setAllowanceWei(undefined);
          try {
            const approval = requestAddress ? await checkCasinoApproval(requestAddress, bConfig.buildingToken) : undefined;
            if (isCurrent()) setAllowanceWei(approval);
          } catch {
            if (isCurrent()) setAllowanceError(true);
          }
        } else {
          const tokenAddresses = await casinoGetSupportedTokens({ throwOnError: true });
          const tokenConfigs = await Promise.all(tokenAddresses.map(async tokenAddress => {
            const [rouletteConfig, blackjackConfig, baccaratConfig] = await Promise.all([
              casinoGetTokenConfig(tokenAddress), blackjackGetTokenConfig(tokenAddress), baccaratGetTokenConfig(tokenAddress),
            ]);
            if (!rouletteConfig || !blackjackConfig || !baccaratConfig) throw new Error('Game configuration unavailable');
            return { address: tokenAddress, rouletteConfig, blackjackConfig, baccaratConfig } satisfies CasinoGameToken;
          }));
          if (!isCurrent()) return;
          const selectableTokens = tokenConfigs.filter(entry => entry.rouletteConfig.supported || entry.blackjackConfig.supported || entry.baccaratConfig.supported);
          setSupportedTokens(selectableTokens);
          setSelectedToken(current => current && selectableTokens.some(entry => entry.address.toLowerCase() === current.toLowerCase()) ? current
            : selectableTokens.find(entry => entry.rouletteConfig.enabled || entry.blackjackConfig.enabled || entry.baccaratConfig.enabled)?.address ?? selectableTokens[0]?.address ?? null);
        }
        if (isCurrent()) setConfigurationReady(true);
      } catch {
        if (isCurrent()) setError('Casino configuration could not be checked. Existing rounds can still be resumed below.');
      } finally {
        if (isCurrent()) setLoadedCasinoIdentity(requestIdentity);
      }
    };
    await Promise.all([
      readConfiguration(),
      readRound('roulette', async () => {
        const round = await casinoGetActiveBetV2(requestLandId);
        if (!round) throw new Error('Round unavailable');
        return round.isActive ? round.bettingToken : null;
      }, setActiveRouletteToken),
      readRound('blackjack', async () => {
        const round = await blackjackGetGameSnapshot(requestLandId);
        if (!round) throw new Error('Round unavailable');
        if (!round.isActive) return null;
        const token = await blackjackGetGameToken(requestLandId);
        if (!token) throw new Error('Round token unavailable');
        return token;
      }, setActiveBlackjackToken),
      readRound('baccarat', async () => {
        const round = await baccaratGetActiveGame(requestLandId);
        if (!round) throw new Error('Round unavailable');
        return round.isActive ? round.bettingToken : null;
      }, setActiveBaccaratToken),
    ]);
    if (isCurrent()) setIsLoading(false);
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
    setAllowanceWei(undefined);
    setAllowanceError(false);
    setConfigurationReady(false);
    setStatsError(false);
    setStatsLoading(false);
    setRoundStatus({ roulette: 'loading', blackjack: 'loading', baccarat: 'loading' });
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

    setIsBuilt(true);
    setAllowanceWei(BigInt(0));
    await loadCasinoState(true);
    if (currentCasinoIdentityRef.current !== casinoIdentity) return;
    if (onSpinComplete) onSpinComplete();
  }, [casinoIdentity, loadCasinoState, onSpinComplete]);

  const onApproveSuccess = useCallback(async () => {
    const operationIdentity = casinoIdentity;

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
    roundStatus.roulette !== 'error' &&
    (!configurationReady || roundStatus.roulette !== 'ready' || !selectedToken || rouletteDisabledForToken);
  const blackjackButtonDisabled =
    casinoPolicy.playable &&
    !hasActiveBlackjackGame &&
    roundStatus.blackjack !== 'error' &&
    (!configurationReady || roundStatus.blackjack !== 'ready' || !selectedToken || blackjackDisabledForToken);
  const baccaratButtonDisabled =
    casinoPolicy.playable &&
    !hasActiveBaccaratGame &&
    roundStatus.baccarat !== 'error' &&
    (!configurationReady || roundStatus.baccarat !== 'ready' || !selectedToken || baccaratDisabledForToken);
  const expectedStatsIdentity = selectedToken && isBuilt
    ? `${casinoIdentity}:${selectedToken.toLowerCase()}`
    : null;
  const statsAreCurrent = expectedStatsIdentity !== null && loadedStatsIdentity === expectedStatsIdentity;
  const currentStats = statsAreCurrent ? stats : null;
  const currentBlackjackStats = statsAreCurrent ? bjStats : null;
  const currentBaccaratStats = statsAreCurrent ? baccaratStats : null;

  if (
    loadedCasinoIdentity !== casinoIdentity
  ) {
    return (
      <ResourceState status="loading" title="Loading Casino…" description="Checking games and current prices." className="min-h-32" />
    );
  }

  const approvalToken = approval.active?.token ?? buildingConfig?.token as `0x${string}`;
  const approvalLabel = approval.active?.label ?? `Approve ${buildTokenSymbol} to Build`;
  const buildApproval = <ApproveTransaction disabled={approval.active?.settled} spenderAddress={LAND_CONTRACT_ADDRESS} tokenAddress={approvalToken}
    onSuccess={onApproveSuccess} buttonText={approvalLabel} buttonClassName="w-full"
    onStatusUpdate={approval.observe('build', approvalToken, approvalLabel)} />;

  if (!isBuilt || approval.active?.action === 'build') {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <div className="text-muted-foreground text-sm">
            Build a Casino to play Roulette, Blackjack, and Baccarat.
          </div>
        </div>

        <div className="space-y-4 pt-4 border-t border-border">
          <div className="space-y-2">
            <h4 className="font-semibold text-sm">Build cost</h4>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
              <span className="text-muted-foreground">Instant build</span>
              {buildTokenMetadata.isReady && buildTokenSymbol
                ? <TokenAmount amount={buildCostWei} decimals={buildTokenMetadata.decimals} unit={buildTokenSymbol} mode="cost" className="ml-auto text-right font-semibold" />
                : <span className="ml-auto">—</span>}
            </div>
            {address && buildingConfig && (
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
                <span className="text-muted-foreground">Your balance</span>
                {buildTokenBalance && !buildBalanceError && buildTokenMetadata.isReady && buildTokenSymbol
                  ? <TokenAmount amount={buildTokenBalance.value} decimals={buildTokenMetadata.decimals} unit={buildTokenSymbol} className={`ml-auto text-right font-medium ${buildReadiness === 'insufficient' ? 'text-destructive' : ''}`} />
                  : <span className="ml-auto">—</span>}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Build Casino</span>
            </div>

            {approval.active ? buildApproval : !address || !walletClient ? (
              <Button className="w-full" variant="secondary" disabled>
                Connect wallet to build
              </Button>
            ) : !configurationReady || !buildingConfig ? (
              <ResourceState status={error ? 'error' : 'loading'} title={error ? 'Build configuration unavailable' : 'Checking build price…'} onRetry={() => { void loadCasinoState(false); }} />
            ) : !buildTokenMetadata.isReady ? (
              <ResourceState status={buildTokenMetadata.isError ? 'error' : 'loading'} title={buildTokenMetadata.isError ? 'Build token details unavailable' : 'Checking build token…'} description="The price must be verified before approving or building." onRetry={() => { void buildTokenMetadata.refetch(); }} />
            ) : buildReadiness !== 'ready' && buildReadiness !== 'approval_required' ? (
              <PurchaseReadinessNotice state={buildReadiness} symbol={buildTokenSymbol} cost={buildCostWei}
                balance={buildTokenBalance?.value} decimals={buildTokenMetadata.decimals}
                onRetryBalance={() => { void refetchBuildTokenBalance(); }} onRetryAllowance={() => { void loadCasinoState(false); }} />
            ) : buildReadiness === 'approval_required' ? (
              buildApproval
            ) : (
              <GameTransaction
                effects={{ domains: ["arcade", "buildings", "lands", "balances"] }}
                intentKey={`casino:build:${landId}`}
                calls={[buildCasinoBuildCall(landId)]}
                onSuccess={onBuildSuccess}
                onError={(err) => setError(err instanceof Error ? err.message : 'Casino could not be built. Please retry.')}
                buttonText={`Build (${buildCostDisplay} ${buildTokenSymbol})`}
                buttonClassName="w-full"
                disabled={!walletClient || !configurationReady || !buildingConfig || buildReadiness !== 'ready' || !buildTokenMetadata.isReady}
                onButtonClick={async () => {
                  const fresh = await casinoGetBuildingConfig();
                  if (currentCasinoIdentityRef.current !== casinoIdentity) throw new Error('Your land or wallet changed. Review the build again.');
                  if (!fresh || fresh.buildingToken !== buildingConfig?.token || fresh.buildingCost !== buildingConfig.cost) {
                    void loadCasinoState(false);
                    throw new Error('The build price could not be confirmed. Review the refreshed price before continuing.');
                  }
                }}
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
    <div className="space-y-4">
      {error && <ResourceState status="error" title="Casino configuration unavailable" description={error} onRetry={() => { void loadCasinoState(true); }} />}
      {Object.values(roundStatus).some(status => status === 'error') && <ResourceState status="error" title="Some round statuses could not be checked" description="Known rounds remain available to resume. Use Check round for a game whose status is unavailable." onRetry={() => { void loadCasinoState(true); }} />}
      {isLoading && <p role="status" className="text-xs text-muted-foreground">Refreshing Casino status…</p>}
      <div className="text-muted-foreground text-sm">
        Roulette and Baccarat use block reveal; Blackjack uses verified signed randomness.
        <div className="mt-2 text-xs text-primary font-medium bg-primary/10 p-2 rounded border border-primary/20 text-left">
          Roulette and Baccarat have a {BACCARAT_REVEAL_WINDOW_BLOCKS.toString()}-block reveal window ({formatUpgradeDuration(BACCARAT_REVEAL_WINDOW_BLOCKS)}). Follow the deadline shown in the game; expired bets are forfeited. For Blackjack, follow the timer shown for your current action.
        </div>
      </div>

      {supportedTokens.length > 0 ? (
        <div className="space-y-2 pt-1">
          <div className="text-sm font-medium text-muted-foreground">Betting token</div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className="flex h-11 min-h-11 w-full min-w-0 justify-between gap-3"
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
            <DropdownMenuContent matchTriggerWidth className="">
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
      ) : configurationReady ? (
        <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          No casino tokens are configured yet.
        </div>
      ) : null}

      {selectedToken && (statsError ? <ResourceState status="error" title="Statistics unavailable" description="Any retained statistics are from the last successful check." onRetry={() => { void loadSelectedTokenStats(); }} />
        : statsLoading ? <p role="status" className="text-xs text-muted-foreground">Checking statistics…</p> : null)}

      {(currentStats || currentBlackjackStats || currentBaccaratStats) && selectedToken && (
        <div className="flex flex-col gap-1 text-xs text-muted-foreground py-1">
          {!selectedTokenMetadata.isReady && <ResourceState status={selectedTokenMetadata.isError ? 'error' : 'loading'} title={selectedTokenMetadata.isError ? 'Token amounts unavailable' : 'Checking token details…'} onRetry={() => { void selectedTokenMetadata.refetch(); }} />}
          {currentStats && (
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              <span>Roulette</span>
              <span>Games: {currentStats.games.toString()}</span>
              <span>Wagered: {formatSelectedAmount(currentStats.wagered)}</span>
              <span>Payouts: {formatSelectedAmount(currentStats.won)}</span>
            </div>
          )}
          {casinoPolicy.blackjackEnabled && currentBlackjackStats && (
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              <span>Blackjack</span>
              <span>Games: {currentBlackjackStats.games.toString()}</span>
              <span>Wagered: {formatSelectedAmount(currentBlackjackStats.wagered)}</span>
              <span>Payouts: {formatSelectedAmount(currentBlackjackStats.won)}</span>
            </div>
          )}
          {currentBaccaratStats && (
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              <span>Baccarat</span>
              <span>Games: {currentBaccaratStats.games.toString()}</span>
              <span>Wagered: {formatSelectedAmount(currentBaccaratStats.wagered)}</span>
              <span>Payouts: {formatSelectedAmount(currentBaccaratStats.won)}</span>
            </div>
          )}
          <p>Payout totals include returned stakes.{casinoPolicy.blackjackEnabled && currentBlackjackStats ? ' Blackjack totals exclude surrender refunds.' : ''}</p>
        </div>
      )}

      <div className="flex flex-col gap-2 pt-2">
        <Button
          className={ROULETTE_BUTTON_CLASS}
          onClick={() => handleOpenCasinoGame("roulette")}
          disabled={rouletteButtonDisabled}
          aria-label={hasActiveRouletteGame ? "Resume Roulette game" : roundStatus.roulette === 'error' ? 'Check Roulette round' : "Play Roulette"}
          leadingIcon={<span className="text-base leading-none" aria-hidden="true">🎰</span>}
        >
          {hasActiveRouletteGame ? "Resume Roulette" : roundStatus.roulette === 'error' ? 'Check Roulette round' : "Play Roulette"}
        </Button>
        {casinoPolicy.blackjackEnabled && (
          <Button
            className={BLACKJACK_BUTTON_CLASS}
            onClick={() => handleOpenCasinoGame("blackjack")}
            disabled={blackjackButtonDisabled}
            aria-label={hasActiveBlackjackGame ? "Resume Blackjack game" : roundStatus.blackjack === 'error' ? 'Check Blackjack round' : "Play Blackjack"}
            leadingIcon={<span className="text-base leading-none" aria-hidden="true">♦️</span>}
          >
            {hasActiveBlackjackGame ? "Resume Blackjack" : roundStatus.blackjack === 'error' ? 'Check Blackjack round' : "Play Blackjack"}
          </Button>
        )}
        <Button
          className={BACCARAT_BUTTON_CLASS}
          onClick={() => handleOpenCasinoGame("baccarat")}
          disabled={baccaratButtonDisabled}
          aria-label={hasActiveBaccaratGame ? "Resume Baccarat game" : roundStatus.baccarat === 'error' ? 'Check Baccarat round' : "Play Baccarat"}
          leadingIcon={<span className="text-base leading-none" aria-hidden="true">♣</span>}
        >
          {hasActiveBaccaratGame ? "Resume Baccarat" : roundStatus.baccarat === 'error' ? 'Check Baccarat round' : "Play Baccarat"}
        </Button>
      </div>

      {hasActiveRouletteGame && (
        <p className="text-xs text-muted-foreground">
          Active Roulette game locked to {formatTokenSymbol(activeRouletteSymbol) || formatAddress(activeRouletteToken!)} until revealed.
        </p>
      )}

      {hasActiveBlackjackGame && (
        <p className="text-xs text-muted-foreground">
          Active Blackjack game locked to {formatTokenSymbol(activeBlackjackSymbol) || formatAddress(activeBlackjackToken!)} until resolved.
        </p>
      )}

      {hasActiveBaccaratGame && (
        <p className="text-xs text-muted-foreground">
          Active Baccarat round locked to {formatTokenSymbol(activeBaccaratSymbol) || formatAddress(activeBaccaratToken!)} until revealed.
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
