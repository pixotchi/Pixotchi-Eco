"use client";
import { isGameTransactionFailure } from "@/lib/game-transaction-status";
import { CasinoGameSurface } from './casino-game-surface';
import { RouletteBetList } from './roulette-bet-list';

import { getTransactionPhase, type LifecycleStatus, type TransactionPhase } from '@/components/transactions/transaction-kit';
import EuropeanRouletteWheel from '@/components/ui/EuropeanRouletteWheel';
import { Button } from '@/components/ui/button';
import { Dialog,DialogFooter } from '@/components/ui/dialog';
import { AmountField } from '@/components/ui/amount-field';
import { useTokenMetadata } from '@/hooks/useTokenMetadata';
import { useRoulettePayouts } from '@/hooks/useRoulettePayouts';
import { useCasinoBetPreference } from '@/hooks/useCasinoBetPreference';
import { formatCasinoLimit,formatCasinoLimitForToken,getCasinoUiMaxBet,getCasinoUiMinBet,isPotentialCasinoAmountInput,parseCasinoAmountInput } from '@/lib/casino-amount-input';
import { getClientCasinoPolicy } from '@/lib/casino-client';
import { getPoolBoundedAdditionalBet, getPoolBoundedMaxBet } from '@/lib/casino-pool-solvency';
import { dispatchPostTransactionRefresh,POST_TRANSACTION_REFRESH_DELAYS_MS } from '@/lib/transaction-refresh';
import {
rouletteBetWins,
rouletteCanReveal,
rouletteHasUnsupportedZeroCombo,
rouletteRevealBlocksRemaining,
} from '@/lib/casino-hardening-rules.mjs';
import {
casinoGetBetDetails,
casinoGetActiveBetV2,
casinoGetTokenConfig,
checkCasinoApproval,
LAND_CONTRACT_ADDRESS,
type CasinoActiveBetV2,
} from '@/lib/contracts';
import { formatTokenAmount,getCasinoTokenImage } from '@/lib/utils';
import { formatUnits } from 'viem';
import type { RouletteReceiptResult } from '@/lib/roulette-receipt';
import { BET_TYPE_NAMES,CasinoBetType } from '@/public/abi/casino-abi';
import { Loader2 } from 'lucide-react';
import Image from 'next/image';
import { useCallback,useEffect,useId,useMemo,useRef,useState } from 'react';
import { toast } from 'react-hot-toast';
import { useAccount,useBalance,useBlockNumber } from 'wagmi';
import ApproveTransaction from './approve-transaction';
import CasinoTransaction from './casino-transaction';
import { RouletteBettingTable, getRouletteNumberColor as getNumberColor } from './roulette-betting-table';

interface CasinoDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    landId: bigint;
    onSpinComplete?: () => void;
    selectedToken: string | null;
}

interface PlacedBet {
    id: string;
    type: CasinoBetType;
    label: string;
    numbers: number[];
    amount: string;
}

const MAX_TOKEN_APPROVAL = BigInt('115792089237316195423570985008687907853269984665640564039457584007913129639935');
const APPROVAL_REFRESH_DELAYS_MS = [0, 750, 1500, 3000] as const;
const ACTIVE_BET_REFRESH_DELAYS_MS = [0, 1500, 4000] as const;
const CASINO_STATE_POLL_INTERVAL_MS = 4000;

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function getRouletteBetLabel(type: CasinoBetType, numbers: number[]): string {
    const sortedNumbers = [...numbers].sort((a, b) => a - b);

    switch (type) {
        case CasinoBetType.STRAIGHT:
            return `Number ${sortedNumbers[0] ?? 0}`;
        case CasinoBetType.SPLIT:
            return `Split ${sortedNumbers.join('-')}`;
        case CasinoBetType.STREET:
            return `Street ${sortedNumbers[0] ?? ''}-${sortedNumbers[sortedNumbers.length - 1] ?? ''}`;
        case CasinoBetType.CORNER:
            return `Corner ${sortedNumbers.join(',')}`;
        case CasinoBetType.SIX_LINE:
            return `6-Line ${sortedNumbers[0] ?? ''}-${sortedNumbers[sortedNumbers.length - 1] ?? ''}`;
        case CasinoBetType.DOZEN:
            return sortedNumbers[0] === 1 ? '1st 12' : sortedNumbers[0] === 2 ? '2nd 12' : '3rd 12';
        case CasinoBetType.COLUMN:
            return sortedNumbers[0] === 1 ? '1st Col' : sortedNumbers[0] === 2 ? '2nd Col' : '3rd Col';
        default:
            return BET_TYPE_NAMES[type] ?? 'Bet';
    }
}

export default function CasinoDialog(props: CasinoDialogProps) {
    const { address } = useAccount();
    return <ScopedCasinoDialog key={`${address?.toLowerCase() ?? ''}:${props.landId}:${props.selectedToken?.toLowerCase() ?? ''}`} {...props} />;
}

function ScopedCasinoDialog({ open, onOpenChange, landId, onSpinComplete, selectedToken }: CasinoDialogProps) {
    const { address } = useAccount();
    const casinoPolicy = getClientCasinoPolicy();
    const betAmountInputId = useId();

    const [placedBets, setPlacedBets] = useState<PlacedBet[]>([]);
    const [currentBetAmount, setCurrentBetAmount] = useState('');
    const [isSpinning, setIsSpinning] = useState(false);
    const [spinPhase, setSpinPhase] = useState<'idle' | 'betting' | 'waiting' | 'revealing'>('idle');
    const [result, setResult] = useState<{ number: number; won: boolean; payoutWei: bigint; wagerWei: bigint | null; bettingToken: string; tokenSymbol?: string; tokenDecimals?: number; transactionHash?: string } | null>(null);
    // European wheel state
    const [wheelSpinning, setWheelSpinning] = useState(false);
    const [wheelWinningNumber, setWheelWinningNumber] = useState<number | null>(null);
    const [expiredResult, setExpiredResult] = useState<{ forfeitedAmountWei: bigint; bettingToken: string; tokenSymbol?: string; tokenDecimals?: number; transactionHash?: string } | null>(null);
    const [config, setConfig] = useState<{ minBet: bigint; maxBet: bigint; bettingToken: string; rewardPool: string; enabled: boolean; maxBetsPerGame: number } | null>(null);
    const [allowanceWei, setAllowanceWei] = useState(BigInt(0));
    const [error, setError] = useState<string | null>(null);
    const [pendingGame, setPendingGame] = useState<boolean>(false);
    const [activeBet, setActiveBet] = useState<CasinoActiveBetV2 | null>(null);
    const [walletTxPending, setWalletTxPending] = useState(false);
    const [transactionPhase, setTransactionPhase] = useState<TransactionPhase>('idle');
    const [configReadStatus, setConfigReadStatus] = useState<'loading' | 'ready' | 'error'>('loading');
    const revealAttemptRef = useRef(false);
    const refreshGenerationRef = useRef(0);
    const refreshScopeRef = useRef('');
    const allowanceGenerationRef = useRef(0);
    const reconciliationGenerationRef = useRef(0);

    const { symbol: tokenSymbolRaw, decimals: tokenDecimals, isReady: metadataReady, isError: metadataError, refetch: refetchMetadata } = useTokenMetadata(config?.bettingToken);
    const tokenSymbol = tokenSymbolRaw || 'TOKEN';
    const { payouts, isReady: payoutsReady, isError: payoutsError, refetch: refetchPayouts } = useRoulettePayouts(open);
    const worstCaseReturnFactor = payouts ? BigInt(Math.max(...Object.values(payouts)) + 1) : BigInt(0);
    const resultToken = result?.bettingToken ?? expiredResult?.bettingToken;
    const resultMetadata = useTokenMetadata(resultToken);
    const resultDecimals = result?.tokenDecimals ?? expiredResult?.tokenDecimals ?? resultMetadata.decimals;
    const resultSymbol = result?.tokenSymbol ?? expiredResult?.tokenSymbol ?? resultMetadata.symbol ?? 'TOKEN';
    const resultLogo = getCasinoTokenImage(resultToken);
    const resultAmountWei = result?.payoutWei ?? expiredResult?.forfeitedAmountWei;
    const resultAmount = resultAmountWei === undefined || resultDecimals === undefined ? 'Amount unavailable' : formatUnits(resultAmountWei, resultDecimals);
    const resultNet = result && result.wagerWei !== null && resultDecimals !== undefined
        ? formatUnits(result.payoutWei - result.wagerWei, resultDecimals) : null;
    const uiMinBet = useMemo(() => (
        config && tokenDecimals !== undefined ? getCasinoUiMinBet(config.bettingToken, tokenDecimals, config.minBet) : BigInt(0)
    ), [config, tokenDecimals]);
    const uiMaxBet = useMemo(() => (
        config && tokenDecimals !== undefined ? getCasinoUiMaxBet(config.bettingToken, tokenDecimals, config.maxBet) : BigInt(0)
    ), [config, tokenDecimals]);
    const formattedMinBet = useMemo(() => (
        config && tokenDecimals !== undefined ? formatCasinoLimitForToken(uiMinBet, tokenDecimals, config.bettingToken, 'min') : 'Unavailable'
    ), [config, tokenDecimals, uiMinBet]);
    const tokenLogo = useMemo(() => getCasinoTokenImage(config?.bettingToken), [config?.bettingToken]);

    const { data: balanceData, refetch: refetchBalance } = useBalance({
        address: address,
        token: config?.bettingToken as `0x${string}` | undefined,
        query: { enabled: !!address && !!config?.bettingToken }
    });
    const { data: payoutPoolData, isLoading: isPayoutPoolLoading, error: payoutPoolError, refetch: refetchPayoutPool } = useBalance({
        address: config?.rewardPool as `0x${string}` | undefined,
        token: config?.bettingToken as `0x${string}` | undefined,
        query: {
            enabled: open && !!config?.rewardPool && !!config?.bettingToken,
            refetchInterval: open ? 10_000 : false,
        },
    });
    const payoutPoolReadStatus: 'unknown' | 'loading' | 'ready' | 'error' = payoutPoolData?.value !== undefined
        ? 'ready'
        : isPayoutPoolLoading
            ? 'loading'
            : payoutPoolError || config
                ? 'error'
                : 'unknown';
    const payoutPoolBalance = payoutPoolData?.value ?? null;
    const poolBoundedMaxBet = useMemo(
        () => getPoolBoundedMaxBet(uiMaxBet, payoutPoolBalance, worstCaseReturnFactor),
        [payoutPoolBalance, uiMaxBet, worstCaseReturnFactor]
    );
    const offeredMaxBet = poolBoundedMaxBet ?? uiMaxBet;
    const formattedMaxBet = useMemo(() => (
        config && tokenDecimals !== undefined ? formatCasinoLimitForToken(offeredMaxBet, tokenDecimals, config.bettingToken, 'max') : 'Unavailable'
    ), [config, offeredMaxBet, tokenDecimals]);
    const refetchBalanceAfterTx = useCallback(() => {
        dispatchPostTransactionRefresh();
        for (const delay of POST_TRANSACTION_REFRESH_DELAYS_MS) {
            if (delay <= 0) {
                void refetchBalance();
                void refetchPayoutPool();
            } else {
                window.setTimeout(() => void refetchBalance(), delay);
                window.setTimeout(() => void refetchPayoutPool(), delay);
            }
        }
    }, [refetchBalance, refetchPayoutPool]);
    const retryPayoutPool = useCallback(() => {
        void refetchPayoutPool().catch((error) => {
            console.warn('Failed to refresh roulette reward pool:', error);
        });
    }, [refetchPayoutPool]);
    const { data: liveBlock } = useBlockNumber({
        watch: open && pendingGame,
        query: {
            enabled: open && pendingGame,
            refetchInterval: open && pendingGame ? 3000 : false,
        },
    });

    const totalBetWei = useMemo(() => {
        if (tokenDecimals === undefined) return BigInt(0);
        try {
            return placedBets.reduce((sum, bet) => sum + parseCasinoAmountInput(bet.amount || '0', tokenDecimals), BigInt(0));
        } catch {
            return BigInt(0);
        }
    }, [placedBets, tokenDecimals]);
    const totalBetAmountDisplay = useMemo(
        () => tokenDecimals === undefined ? 'Unavailable' : formatCasinoLimit(totalBetWei, tokenDecimals),
        [tokenDecimals, totalBetWei]
    );
    const requiredApprovalWei = useMemo(() => {
        if (!config) return BigInt(0);
        if (pendingGame || spinPhase === 'waiting' || spinPhase === 'revealing') return BigInt(0);
        if (totalBetWei > BigInt(0)) return totalBetWei;
        return uiMinBet;
    }, [config, pendingGame, spinPhase, totalBetWei, uiMinBet]);
    const hasApproval = allowanceWei >= requiredApprovalWei;

    // Calculate max win using the same zero handling as the contract.
    const bestPossibleWinWei = useMemo(() => {
        if (placedBets.length === 0 || tokenDecimals === undefined || !payouts) return BigInt(0);

        let maxPayout = BigInt(0);
        for (let num = 0; num <= 36; num++) {
            let payoutForThisNumber = BigInt(0);
            for (const bet of placedBets) {
                let amount = BigInt(0);
                try {
                    amount = parseCasinoAmountInput(bet.amount || '0', tokenDecimals);
                } catch {
                    amount = BigInt(0);
                }
                if (rouletteBetWins(bet.type, bet.numbers, num)) {
                    const multiplier = BigInt(payouts[bet.type]);
                    payoutForThisNumber += amount + (amount * multiplier);
                }
            }
            if (payoutForThisNumber > maxPayout) maxPayout = payoutForThisNumber;
        }
        return maxPayout;
    }, [placedBets, tokenDecimals, payouts]);
    const bestPossibleWinDisplay = useMemo(
        () => tokenDecimals === undefined || !payoutsReady ? 'Unavailable' : formatCasinoLimit(bestPossibleWinWei, tokenDecimals),
        [bestPossibleWinWei, tokenDecimals, payoutsReady]
    );

    const isInsufficientBalance = !!balanceData && totalBetWei > balanceData.value;
    const maxBets = config?.maxBetsPerGame || 2;
    const canAddMoreBets = placedBets.length < maxBets;
    const bettingLocked = pendingGame || spinPhase === 'waiting' || spinPhase === 'revealing' || isSpinning;
    const poolLiquidityBinds = payoutPoolReadStatus === 'ready'
        && poolBoundedMaxBet !== null
        && poolBoundedMaxBet < uiMaxBet;
    const selectedBetsExceedPool = payoutPoolReadStatus === 'ready'
        && payoutPoolBalance !== null
        && bestPossibleWinWei > payoutPoolBalance;
    const selectedBetsOutsideLimits = tokenDecimals !== undefined && placedBets.length > 0 && (
        totalBetWei > offeredMaxBet || placedBets.length > maxBets || placedBets.some(bet => {
            try { return parseCasinoAmountInput(bet.amount, tokenDecimals) < uiMinBet; } catch { return true; }
        })
    );
    const bettingInputDisabled = bettingLocked || configReadStatus !== 'ready' || !metadataReady || !payoutsReady || payoutPoolReadStatus !== 'ready';
    const activeBetBelongsToWallet = !activeBet?.isActive || (!!address && activeBet.player.toLowerCase() === address.toLowerCase());
    const canRevealActiveBet = activeBetBelongsToWallet && rouletteCanReveal(activeBet, liveBlock);
    const revealBlocksRemaining = useMemo(() => {
        return rouletteRevealBlocksRemaining(activeBet, liveBlock);
    }, [activeBet, liveBlock]);
    const hasUnsupportedZeroCombo = useMemo(
        () => placedBets.some((bet) => rouletteHasUnsupportedZeroCombo(bet.type, bet.numbers)),
        [placedBets]
    );
    const refreshScopeKey = [
        open ? 'open' : 'closed',
        casinoPolicy.playable ? 'playable' : 'disabled',
        address?.toLowerCase() ?? '',
        landId.toString(),
        selectedToken?.toLowerCase() ?? '',
        config?.bettingToken.toLowerCase() ?? '',
        tokenDecimals?.toString() ?? 'unknown',
    ].join(':');

    useEffect(() => {
        refreshScopeRef.current = refreshScopeKey;
        refreshGenerationRef.current += 1;
        allowanceGenerationRef.current += 1;
        reconciliationGenerationRef.current += 1;

        return () => {
            if (refreshScopeRef.current === refreshScopeKey) {
                refreshScopeRef.current = '';
            }
            refreshGenerationRef.current += 1;
            allowanceGenerationRef.current += 1;
            reconciliationGenerationRef.current += 1;
        };
    }, [refreshScopeKey]);

    useEffect(() => {
        if (!open || casinoPolicy.playable) return;
        onOpenChange(false);
        toast.error(casinoPolicy.message || 'Casino is currently unavailable.');
    }, [casinoPolicy.message, casinoPolicy.playable, onOpenChange, open]);

    const refreshCasinoState = useCallback(async (options?: { keepPendingWhenMissing?: boolean }) => {
        if (!open || !casinoPolicy.playable || refreshScopeRef.current !== refreshScopeKey) return null;

        const requestGeneration = refreshGenerationRef.current + 1;
        refreshGenerationRef.current = requestGeneration;
        const allowanceGeneration = allowanceGenerationRef.current + 1;
        allowanceGenerationRef.current = allowanceGeneration;
        const isCurrentRequest = () => (
            refreshScopeRef.current === refreshScopeKey &&
            refreshGenerationRef.current === requestGeneration
        );
        setConfigReadStatus(current => current === 'ready' ? current : 'loading');

        try {
            const activeGame = await casinoGetActiveBetV2(landId);
            if (!isCurrentRequest()) return null;
            if (!activeGame) {
                throw new Error('Casino active game read failed');
            }
            // A paid round's recovery needs its active state, not an optional
            // fresh token-config read. Keep reveal available if config fails.
            if (activeGame.isActive) {
                setPendingGame(true);
                setActiveBet(activeGame);
                setSpinPhase(activeGame.canReveal || activeGame.isExpired ? 'revealing' : 'waiting');
            }

            const effectiveToken = activeGame?.isActive ? activeGame.bettingToken : selectedToken;

            if (!effectiveToken) {
                if (!isCurrentRequest()) return null;
                setConfig(null);
                setPendingGame(false);
                setActiveBet(null);
                setAllowanceWei(BigInt(0));
                setConfigReadStatus('error');
                return activeGame;
            }

            const tokenConfig = await casinoGetTokenConfig(effectiveToken);
            if (!isCurrentRequest()) return null;
            if (!tokenConfig) {
                throw new Error('Casino token config read failed');
            }

            let hydratedBets: PlacedBet[] = [];
            if (activeGame?.isActive) {
                const activeBetCount = Number(activeGame.numBets);
                if (activeBetCount > 0 && tokenDecimals !== undefined && config?.bettingToken.toLowerCase() === effectiveToken.toLowerCase()) {
                    const details = await Promise.all(
                        Array.from({ length: activeBetCount }, (_, index) => casinoGetBetDetails(landId, index))
                    );
                    if (!isCurrentRequest()) return null;

                    hydratedBets = details.flatMap((detail, index): PlacedBet[] => {
                        if (!detail) return [];
                        const type = Number(detail.betType) as CasinoBetType;
                        const numbers = detail.betNumbers.map(Number);
                        return [{
                            id: `active-${landId.toString()}-${index}`,
                            type,
                            label: getRouletteBetLabel(type, numbers),
                            numbers,
                            amount: formatUnits(detail.betAmount, tokenDecimals),
                        }];
                    });
                }
            }

            let approval = BigInt(0);
            if (address) {
                approval = await checkCasinoApproval(address, effectiveToken);
            }
            if (!isCurrentRequest()) return null;

            setConfig(tokenConfig?.supported || activeGame?.isActive
                ? {
                    minBet: tokenConfig?.minBet ?? BigInt(0),
                    maxBet: tokenConfig?.maxBet ?? BigInt(0),
                    bettingToken: effectiveToken,
                    rewardPool: tokenConfig?.rewardPool ?? '',
                    enabled: tokenConfig?.enabled ?? false,
                    maxBetsPerGame: Number(tokenConfig?.maxBetsPerGame ?? BigInt(2)) || 2,
                }
                : null);

            if (activeGame?.isActive) {
                setPendingGame(true);
                setActiveBet(activeGame);
                setSpinPhase(activeGame.canReveal || activeGame.isExpired ? 'revealing' : 'waiting');
                if (hydratedBets.length > 0) {
                    setPlacedBets(hydratedBets);
                    setCurrentBetAmount(hydratedBets[0].amount);
                }
            } else if (options?.keepPendingWhenMissing) {
                setPendingGame(true);
                setActiveBet(null);
                setSpinPhase('waiting');
            } else {
                setPendingGame(false);
                setActiveBet(null);
                setSpinPhase('idle');
            }

            if (allowanceGenerationRef.current === allowanceGeneration) {
                setAllowanceWei(approval);
            }
            setConfigReadStatus(tokenConfig.supported || activeGame.isActive ? 'ready' : 'error');

            return activeGame;
        } catch (e) {
            if (isCurrentRequest()) {
                console.error('Failed to load casino config:', e);
                setConfigReadStatus('error');
            }
            return null;
        }
    }, [address, casinoPolicy.playable, config?.bettingToken, landId, open, refreshScopeKey, selectedToken, tokenDecimals]);

    useEffect(() => {
        if (!open || !casinoPolicy.playable) return;
        void refreshCasinoState();
    }, [casinoPolicy.playable, open, refreshCasinoState]);

    useEffect(() => {
        if (!open || !pendingGame || isSpinning) return;

        let disposed = false;
        let timeoutId: number | null = null;
        const keepPendingWhenMissing = !activeBet?.isActive;

        const poll = async () => {
            await refreshCasinoState({ keepPendingWhenMissing });
            if (!disposed) {
                timeoutId = window.setTimeout(() => void poll(), CASINO_STATE_POLL_INTERVAL_MS);
            }
        };

        timeoutId = window.setTimeout(() => void poll(), CASINO_STATE_POLL_INTERVAL_MS);

        return () => {
            disposed = true;
            if (timeoutId !== null) window.clearTimeout(timeoutId);
        };
    }, [activeBet?.isActive, isSpinning, open, pendingGame, refreshCasinoState]);

    useEffect(() => {
        if (!pendingGame || !activeBet?.isActive || isSpinning) return;
        setSpinPhase(canRevealActiveBet ? 'revealing' : 'waiting');
    }, [activeBet?.isActive, canRevealActiveBet, isSpinning, pendingGame]);

    const configBettingToken = config?.bettingToken ?? null;
    const rememberBetPreference = useCasinoBetPreference({
        game: 'roulette', scope: open ? `${address?.toLowerCase() ?? ''}:${landId}` : null,
        enabled: !pendingGame && payoutsReady && payoutPoolReadStatus === 'ready',
        token: configBettingToken, decimals: tokenDecimals, minBet: uiMinBet, maxBet: offeredMaxBet,
        onInitialize: setCurrentBetAmount,
    });
    const handleCurrentBetAmountChange = useCallback((value: string) => {
        if (!isPotentialCasinoAmountInput(value)) return;
        setCurrentBetAmount(value);
        rememberBetPreference(value);
    }, [rememberBetPreference]);
    const currentStakeLabel = (() => {
        if (tokenDecimals === undefined) return undefined;
        try { return `${formatUnits(parseCasinoAmountInput(currentBetAmount, tokenDecimals), tokenDecimals)} ${tokenSymbol}`; } catch { return undefined; }
    })();
    const draftExceedsLimit = (() => {
        if (tokenDecimals === undefined || !payoutsReady || payoutPoolReadStatus !== 'ready') return false;
        try { return parseCasinoAmountInput(currentBetAmount, tokenDecimals) + totalBetWei > offeredMaxBet; } catch { return false; }
    })();

    // Callback when wheel animation ends
    const handleWheelSpinEnd = useCallback(() => {
        setWheelSpinning(false);
    }, []);

    const addBet = useCallback((type: CasinoBetType, label: string, numbers: number[]) => {
        if (!metadataReady || tokenDecimals === undefined || configReadStatus !== 'ready' || !payouts) {
            toast.error('Verify the game and token details before choosing bets.');
            return;
        }
        if (bettingLocked) {
            toast.error('Finish the current spin before changing bets');
            return;
        }
        if (config && !config.enabled && !pendingGame) {
            toast.error('Roulette is currently disabled');
            return;
        }
        if (payoutPoolReadStatus !== 'ready' || payoutPoolBalance === null) {
            toast.error('Reward pool liquidity is still being verified');
            return;
        }
        if (!canAddMoreBets) { toast.error(`Maximum ${maxBets} bets per spin`); return; }
        if (rouletteHasUnsupportedZeroCombo(type, numbers)) {
            toast.error('Only straight bets can include 0.');
            return;
        }

        // Validate Min/Max Bet
        if (config) {
            try {
                const amountVal = parseCasinoAmountInput(currentBetAmount, tokenDecimals);

                // Min check (per bet)
                if (amountVal < uiMinBet) {
                    toast.error(`Minimum bet is ${formattedMinBet} ${tokenSymbol}`);
                    return;
                }

                // Max check (Total Wager)
                const currentTotal = placedBets.reduce((acc, b) => acc + parseCasinoAmountInput(b.amount, tokenDecimals), BigInt(0));
                const projectedTotal = currentTotal + amountVal;

                if (projectedTotal > offeredMaxBet) {
                    const remaining = offeredMaxBet - currentTotal;
                    toast.error(`Total bet limit is ${formattedMaxBet} ${tokenSymbol}. You can add max ${formatCasinoLimit(remaining > BigInt(0) ? remaining : BigInt(0), tokenDecimals)} ${tokenSymbol}`);
                    return;
                }

                const candidateReturnFactor = BigInt(payouts[type] + 1);
                const maxAdditionalBet = getPoolBoundedAdditionalBet(
                    payoutPoolBalance,
                    bestPossibleWinWei,
                    candidateReturnFactor,
                );
                if (maxAdditionalBet === null || amountVal > maxAdditionalBet) {
                    toast.error(`Reward pool can cover at most ${formatCasinoLimit(maxAdditionalBet ?? BigInt(0), tokenDecimals)} ${tokenSymbol} for this bet`);
                    return;
                }
            } catch {
                toast.error('Invalid bet amount');
                return;
            }
        }

        const exists = placedBets.some(b => b.type === type && JSON.stringify([...b.numbers].sort()) === JSON.stringify([...numbers].sort()));
        if (exists) { toast.error('Bet already placed'); return; }
        const displayLabel = type === CasinoBetType.STRAIGHT ? getRouletteBetLabel(type, numbers) : label;
        const newBet: PlacedBet = { id: `${Date.now()}-${Math.random()}`, type, label: displayLabel, numbers, amount: currentBetAmount };
        setResult(null);
        setExpiredResult(null);
        setError(null);
        setPlacedBets(prev => [...prev, newBet]);
        toast.success(`Added ${displayLabel} bet`);
    }, [metadataReady, configReadStatus, payouts, bettingLocked, canAddMoreBets, currentBetAmount, maxBets, placedBets, config, tokenDecimals, tokenSymbol, pendingGame, formattedMaxBet, formattedMinBet, offeredMaxBet, uiMinBet, payoutPoolBalance, payoutPoolReadStatus, bestPossibleWinWei]);

    const removeBet = useCallback((id: string) => { setPlacedBets(prev => prev.filter(b => b.id !== id)); }, []);
    const clearBets = useCallback(() => { setPlacedBets([]); }, []);

    const hasBet = useCallback((type: CasinoBetType, numbers: number[]) => {
        return placedBets.some(b => b.type === type && JSON.stringify([...b.numbers].sort()) === JSON.stringify([...numbers].sort()));
    }, [placedBets]);

    // Prepare bet data for CasinoTransaction
    const betTypes = useMemo(() => placedBets.map(b => b.type), [placedBets]);
    const betNumbersArray = useMemo(() => placedBets.map(b => b.numbers), [placedBets]);
    const betAmounts = useMemo(() => tokenDecimals === undefined ? [] : placedBets.map(b => parseCasinoAmountInput(b.amount, tokenDecimals)), [placedBets, tokenDecimals]);

    // Handle place bets completion
    const syncPlacedRouletteState = useCallback(async () => {
        if (refreshScopeRef.current !== refreshScopeKey) return;
        const reconciliationGeneration = reconciliationGenerationRef.current + 1;
        reconciliationGenerationRef.current = reconciliationGeneration;
        const isCurrentReconciliation = () => (
            refreshScopeRef.current === refreshScopeKey &&
            reconciliationGenerationRef.current === reconciliationGeneration
        );

        for (const delayMs of ACTIVE_BET_REFRESH_DELAYS_MS) {
            if (delayMs > 0) await wait(delayMs);
            if (!isCurrentReconciliation()) return;
            const latestActiveBet = await refreshCasinoState({ keepPendingWhenMissing: true });
            if (!isCurrentReconciliation()) return;
            if (latestActiveBet?.isActive) {
                setError(null);
                return;
            }
        }

        setError('Bet was submitted. Waiting for the onchain game state to catch up...');
    }, [refreshCasinoState, refreshScopeKey]);

    const handlePlaceBetsComplete = useCallback((result?: object) => {
        setWalletTxPending(false);
        if (result === undefined) {
            // Transaction failed
            setError('Failed to place bets');
            setIsSpinning(false);
            setSpinPhase('idle');
            setWheelSpinning(false);
            setActiveBet(null);
            setPendingGame(false);
            return;
        }
        // Bets placed successfully, transition to waiting/reveal phase
        setError(null); // Clear any previous errors
        setIsSpinning(false); // Stop the spinning state from placeBets
        setSpinPhase('waiting');
        setPendingGame(true);
        setActiveBet(null);
        refetchBalanceAfterTx();
        void syncPlacedRouletteState();
    }, [refetchBalanceAfterTx, syncPlacedRouletteState]);

    // Handle reveal completion
    const handleRevealComplete = useCallback((result?: Partial<RouletteReceiptResult> & { receiptIncomplete?: boolean }) => {
        const shouldProcess = revealAttemptRef.current || pendingGame || spinPhase === 'revealing' || isSpinning;
        if (!shouldProcess || refreshScopeRef.current !== refreshScopeKey) return;

        const reconciliationGeneration = reconciliationGenerationRef.current + 1;
        reconciliationGenerationRef.current = reconciliationGeneration;
        const isCurrentReconciliation = () => (
            refreshScopeRef.current === refreshScopeKey &&
            reconciliationGenerationRef.current === reconciliationGeneration
        );

        setWalletTxPending(false);
        revealAttemptRef.current = false;
        setIsSpinning(false);
        setSpinPhase('idle');

        if (result === undefined) {
            setError('Reveal failed');
            setWheelSpinning(false);
            void refreshCasinoState();
            return;
        }

        const snapshotMetadata = result.bettingToken?.toLowerCase() === config?.bettingToken.toLowerCase()
            ? { tokenSymbol: tokenSymbolRaw, tokenDecimals } : {};
        if (result.expired && result.forfeitedAmountWei !== undefined && result.bettingToken) {
            setError(null);
            setResult(null);
            setExpiredResult({ forfeitedAmountWei: result.forfeitedAmountWei, bettingToken: result.bettingToken, transactionHash: result.transactionHash, ...snapshotMetadata });
            setWheelSpinning(false);
            refetchBalanceAfterTx();
            setPendingGame(false);
            setActiveBet(null);
            setPlacedBets([]);
            onSpinComplete?.();
            return;
        }

        if (result.winningNumber !== undefined && result.payoutWei !== undefined && result.bettingToken) {
            setError(null); // Clear any errors on success
            setExpiredResult(null);
            setResult({
                number: result.winningNumber,
                won: result.won ?? false,
                payoutWei: result.payoutWei, wagerWei: activeBet?.totalBetAmount ?? (placedBets.length > 0 ? totalBetWei : null), bettingToken: result.bettingToken, transactionHash: result.transactionHash, ...snapshotMetadata
            });
            setWheelWinningNumber(result.winningNumber);
            refetchBalanceAfterTx();
            setPendingGame(false);
            setActiveBet(null);
            setPlacedBets([]);
            onSpinComplete?.();
            return;
        } else {
            setWheelSpinning(false);
            setError(result.receiptIncomplete
                ? 'Spin completed, but the wallet did not return the result. Refreshing game state...'
                : 'Could not verify result');
        }

        void (async () => {
            let sawSuccessfulRead = false;
            for (const delayMs of ACTIVE_BET_REFRESH_DELAYS_MS) {
                if (delayMs > 0) await wait(delayMs);
                if (!isCurrentReconciliation()) return;
                const latestActiveBet = await casinoGetActiveBetV2(landId);
                if (!isCurrentReconciliation()) return;

                // The read helper returns null on RPC failure. That is unknown,
                // not proof that the round settled, so retry without unlocking.
                if (!latestActiveBet) continue;
                sawSuccessfulRead = true;

                if (!latestActiveBet.isActive) {
                    setPendingGame(false);
                    setActiveBet(null);
                    setPlacedBets([]);
                    setSpinPhase('idle');
                    setError('Spin completed. Check recent activity for the result.');
                    refetchBalanceAfterTx();
                    onSpinComplete?.();
                    return;
                }

                setPendingGame(true);
                setActiveBet(latestActiveBet);
                setSpinPhase(latestActiveBet.canReveal || latestActiveBet.isExpired ? 'revealing' : 'waiting');
            }

            if (!isCurrentReconciliation()) return;
            setError(sawSuccessfulRead
                ? 'Reveal was submitted, but the game still appears active. Try revealing again after the next refresh.'
                : 'Reveal was submitted, but the game state could not be refreshed. Try again after your connection recovers.');
        })();
    }, [isSpinning, landId, onSpinComplete, pendingGame, refetchBalanceAfterTx, refreshCasinoState, refreshScopeKey, spinPhase, config?.bettingToken, tokenSymbolRaw, tokenDecimals, activeBet?.totalBetAmount, placedBets.length, totalBetWei]);

    // Handle transaction status updates for UI feedback
    const handleStatusUpdate = useCallback((status: LifecycleStatus) => {
        setTransactionPhase(getTransactionPhase(status));
        if (status.statusName === 'buildingTransaction' || status.statusName === 'transactionPending') {
            setWalletTxPending(true);
            if (pendingGame || spinPhase === 'revealing') {
                revealAttemptRef.current = true;
            }
            setError(null);
            setIsSpinning(true);
            setResult(null);
            setExpiredResult(null);
            setWheelWinningNumber(null);
            setWheelSpinning(true);
        }
        if (isGameTransactionFailure(status.statusName)) {
            setWalletTxPending(false);
            setIsSpinning(false);
            setWheelSpinning(false);
            setSpinPhase(pendingGame ? 'waiting' : 'idle');
        }
        if (status.statusName === 'success') {
            setWalletTxPending(false);
        }
    }, [pendingGame, spinPhase]);

    const handleClose = useCallback((nextOpen: boolean) => {
        if (nextOpen) {
            onOpenChange(true);
            return;
        }

        if (walletTxPending) {
            toast(transactionPhase === 'awaiting-wallet' ? 'Confirm or reject the request in your wallet before closing.' : 'Transaction submitted. Waiting for confirmation.');
            return;
        }

        if (pendingGame) {
            toast('Roulette game remains active onchain. Reopen Casino to reveal or settle it.');
        }

        setIsSpinning(false);
        setWheelSpinning(false);
        setSpinPhase(pendingGame ? 'waiting' : 'idle');
        onOpenChange(false);
    }, [onOpenChange, pendingGame, transactionPhase, walletTxPending]);

    // Button click handler to start spinning immediately
    const handleSpinButtonClick = useCallback(() => {
        if (hasUnsupportedZeroCombo) {
            setError('Only straight bets can include 0.');
            return false;
        }
        if (bettingInputDisabled || selectedBetsOutsideLimits || selectedBetsExceedPool) {
            setError('Review the current bet limits and game details before submitting.');
            return false;
        }
        setSpinPhase('betting');
        setError(null);
        setResult(null);
        setExpiredResult(null);
        setWheelWinningNumber(null);
        setWheelSpinning(true);
    }, [bettingInputDisabled, hasUnsupportedZeroCombo, selectedBetsExceedPool, selectedBetsOutsideLimits]);

    const handleRevealButtonClick = useCallback(() => {
        revealAttemptRef.current = true;
        setSpinPhase('revealing');
        setError(null);
        setResult(null);
        setExpiredResult(null);
        setWheelWinningNumber(null);
        setWheelSpinning(true);
    }, []);

    const refreshApproval = useCallback(async (optimistic = false) => {
        if (!address || !config?.bettingToken || refreshScopeRef.current !== refreshScopeKey) return;

        const allowanceGeneration = allowanceGenerationRef.current + 1;
        allowanceGenerationRef.current = allowanceGeneration;
        const isCurrentAllowanceRequest = () => (
            refreshScopeRef.current === refreshScopeKey &&
            allowanceGenerationRef.current === allowanceGeneration
        );

        if (optimistic && isCurrentAllowanceRequest()) {
            setAllowanceWei(MAX_TOKEN_APPROVAL);
        }

        let latestAllowance = BigInt(0);
        for (const delayMs of APPROVAL_REFRESH_DELAYS_MS) {
            if (delayMs > 0) await wait(delayMs);
            if (!isCurrentAllowanceRequest()) return;

            const approval = await checkCasinoApproval(address, config.bettingToken);
            if (!isCurrentAllowanceRequest()) return;
            latestAllowance = approval;
            if (approval >= requiredApprovalWei) {
                setAllowanceWei(approval);
                return;
            }
        }

        if (!optimistic) {
            setAllowanceWei(latestAllowance);
        } else {
            console.warn('Approval transaction succeeded, but allowance read has not caught up yet.');
        }
    }, [address, config?.bettingToken, refreshScopeKey, requiredApprovalWei]);

    const revealModeActive = pendingGame || spinPhase === 'waiting' || spinPhase === 'revealing';
    const revealButtonDisabled = isSpinning || !activeBetBelongsToWallet || (revealModeActive && !canRevealActiveBet);
    const revealButtonText = isSpinning
        ? (spinPhase === 'waiting' ? 'Waiting...' : 'Revealing...')
        : !activeBetBelongsToWallet
            ? 'Game active in another wallet'
            : pendingGame && activeBet?.isExpired
                ? 'Settle expired game'
                : revealModeActive && !canRevealActiveBet
                ? (revealBlocksRemaining > 0 ? `Waiting ${revealBlocksRemaining} block${revealBlocksRemaining === 1 ? '' : 's'}` : 'Waiting for block...')
                : 'Reveal Result';
    const wheelSettling = wheelSpinning && wheelWinningNumber !== null;
    const showRoundResult = !!result && !isSpinning && !wheelSpinning;
    const showExpiredRoundResult = !!expiredResult && !isSpinning && !wheelSpinning;
    const rouletteAnnouncement = showRoundResult && result
        ? `Roulette result ${result.number}. Return including stake: ${resultAmount} ${resultSymbol}. ${resultNet === null ? 'Net result unavailable.' : `Net result: ${resultNet} ${resultSymbol}.`}`
        : showExpiredRoundResult && expiredResult
            ? `Roulette bet expired. ${resultAmount} ${resultSymbol} forfeited.`
            : wheelSettling
                ? 'Roulette wheel settling result.'
                : isSpinning
                    ? spinPhase === 'betting'
                        ? 'Placing roulette bets.'
                        : spinPhase === 'waiting'
                            ? 'Waiting for roulette reveal block.'
                            : spinPhase === 'revealing'
                                ? 'Revealing roulette result.'
                                : 'Roulette spin in progress.'
                    : '';

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <CasinoGameSurface
                variant="roulette"
                title="Roulette"
                onClose={() => handleClose(false)}
                preventEscape={walletTxPending || pendingGame}
                description="Roulette game dialog with betting controls, active spin state, reveal controls, and transaction status."
            >
                <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
                    {rouletteAnnouncement}
                </p>


                <div className="relative space-y-3 sm:space-y-4">
                    <div className="flex items-center justify-between gap-3 text-white">
                        <span className="inline-flex items-center gap-2 text-sm"><Image src={tokenLogo} alt="" width={20} height={20} />{tokenSymbol}</span>
                    </div>
                    <details className="rounded-md border border-white/20 bg-black/35 px-3 py-2 text-sm text-white">
                        <summary className="min-h-11 cursor-pointer py-2 font-medium">How to play and payouts</summary>
                        <div className="space-y-2 pb-2 pt-1 text-white/80">
                            <p>Choose up to {maxBets} different bets. Each selection uses the amount below. Submit your stake, then return to reveal the result after the next block.</p>
                            <p>A winning bet returns its stake plus its listed profit odds. Zero wins only a straight bet on 0; all other selections lose on zero.</p>
                            <p>Minimum applies to each selection. Maximum stake applies to the whole round and can be reduced by the available reward pool.</p>
                            {payoutsReady && <p>Single number {payouts?.[CasinoBetType.STRAIGHT]}:1 · Split {payouts?.[CasinoBetType.SPLIT]}:1 · Street {payouts?.[CasinoBetType.STREET]}:1 · Corner {payouts?.[CasinoBetType.CORNER]}:1 · Six line {payouts?.[CasinoBetType.SIX_LINE]}:1 · Dozen/column {payouts?.[CasinoBetType.DOZEN]}:1 · Outside {payouts?.[CasinoBetType.RED]}:1.</p>}
                        </div>
                    </details>
                    {/* Wheel + Bets Panel Side by Side */}
                    <div className="grid gap-3 md:grid-cols-[minmax(11rem,13.5rem)_minmax(0,1fr)] md:items-stretch md:gap-4">
                        {/* European Roulette Wheel - Left Side */}
                        <div className="mx-auto flex flex-col items-center justify-center gap-2">
                            <div className="w-40 h-40 md:w-48 md:h-48">
                                <EuropeanRouletteWheel
                                    spinning={wheelSpinning}
                                    winningNumber={wheelWinningNumber}
                                    onSpinComplete={handleWheelSpinEnd}
                                />
                            </div>
                            {/* Result badge below wheel */}
                            {result && !wheelSpinning && (
                                <div aria-hidden="true" className={`px-3 py-1 rounded-full text-white font-bold text-xs shadow-lg ${getNumberColor(result.number)}`}>
                                    {result.number}
                                </div>
                            )}
                            {/* Spin Status */}
                            {(isSpinning || wheelSettling) && (
                                <div className="text-center text-sm text-white/90">
                                    <Loader2 aria-hidden="true" className="inline h-4 w-4 animate-spin mr-2" />
                                    {wheelSettling
                                        ? 'Settling result...'
                                        : transactionPhase === 'awaiting-wallet' ? 'Confirm or reject in your wallet' : <>{spinPhase === 'betting' && 'Bet submitted — confirming...'}{spinPhase === 'waiting' && 'Waiting for block...'}{spinPhase === 'revealing' && 'Reveal submitted — confirming...'}</>}
                                </div>
                            )}
                        </div>

                        {/* Bets Panel - Right Side */}
                        <div className="w-full min-w-0">
                            <div className="h-full rounded-md border border-white/10 bg-black/35 p-2 text-white backdrop-blur-[var(--blur-surface)] sm:p-2.5">
                                <RouletteBetList bets={placedBets} payouts={payouts} limit={maxBets} locked={bettingLocked} tokenLogo={tokenLogo} tokenSymbol={tokenSymbol} onClear={clearBets} onRemove={removeBet} />
                                {placedBets.length > 0 && (
                                    <div className="mt-2 grid grid-cols-2 gap-2 border-t border-white/10 pt-2 text-[11px]">
                                        <span className="flex min-w-0 flex-col gap-1">Total stake <strong className="flex min-w-0 items-center gap-1"><Image src={tokenLogo} alt={tokenSymbol} width={14} height={14} className="h-3.5 w-3.5 shrink-0 rounded-full" /><span className="min-w-0 tabular-nums [overflow-wrap:anywhere]">{totalBetAmountDisplay}</span></strong></span>
                                        <span className="flex min-w-0 flex-col items-end gap-1 text-right text-green-300">Maximum return incl. stake <strong className="flex min-w-0 items-center gap-1"><Image src={tokenLogo} alt={tokenSymbol} width={14} height={14} className="h-3.5 w-3.5 shrink-0 rounded-full" /><span className="min-w-0 tabular-nums [overflow-wrap:anywhere]">{bestPossibleWinDisplay}</span></strong></span>
                                    </div>
                                )}
                            </div>

                        </div>
                    </div>

                    {/* Round Result */}
                    {showRoundResult && result && (
                        <div
                            className={`relative z-0 rounded-[var(--radius-panel)] border p-3 text-sm shadow-[0_12px_32px_rgba(0,0,0,0.32)] backdrop-blur-md ${result.won
                                ? 'border-green-300/45 bg-green-950/75 text-green-50'
                                : 'border-white/15 bg-black/70 text-white'
                                }`}
                        >
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div className="flex min-w-0 items-center gap-3">
                                    <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-black text-white shadow-lg ${getNumberColor(result.number)}`}>
                                        {result.number}
                                    </span>
                                    <div className="min-w-0">
                                        <div className="text-[11px] font-semibold uppercase tracking-wide text-white/60">Round result</div>
                                        <div className="text-base font-bold leading-tight">
                                            {result.won ? 'Winning spin' : 'No win this spin'}
                                        </div>
                                    </div>
                                </div>

                                {result.won ? (
                                    <div className="inline-flex items-center gap-1.5 rounded-full border border-green-200/30 bg-green-400/15 px-3 py-1.5 font-bold text-green-100">
                                        <span>Winning selection</span>
                                    </div>
                                ) : (
                                    <div className="rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white/75">
                                        Better luck next spin
                                    </div>
                                )}
                            </div>
                            <dl className="mt-3 grid gap-2 border-t border-white/20 pt-3 text-sm [overflow-wrap:anywhere] sm:grid-cols-2">
                                <div><dt className="text-white/65">Return including stake</dt><dd>{resultAmount} {resultSymbol}</dd></div>
                                <div><dt className="text-white/65">Net result</dt><dd>{resultNet === null ? 'Stake amount unavailable' : `${resultNet.startsWith('-') || resultNet === '0' ? '' : '+'}${resultNet} ${resultSymbol}`}</dd></div>
                            </dl>
                        </div>
                    )}

                    {showExpiredRoundResult && expiredResult && (
                        <div
                            className="relative z-0 rounded-[var(--radius-panel)] border border-yellow-300/40 bg-black/70 p-3 text-sm text-white shadow-[0_12px_32px_rgba(0,0,0,0.32)] backdrop-blur-md"
                        >
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                    <div className="text-[11px] font-semibold uppercase tracking-wide text-yellow-200/70">Round result</div>
                                    <div className="text-base font-bold leading-tight text-yellow-100">Bet expired</div>
                                </div>
                                <div className="inline-flex items-center gap-1.5 rounded-full border border-yellow-200/25 bg-yellow-400/10 px-3 py-1.5 font-bold text-yellow-100">
                                    <Image src={resultLogo} alt={resultSymbol} width={16} height={16} className="h-4 w-4 rounded-full" />
                                    <span className="[overflow-wrap:anywhere]">{resultAmount} {resultSymbol} forfeited</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Bet Amount */}
                    <div className="flex flex-wrap items-center gap-2">
                        <AmountField
                            id={betAmountInputId}
                            label="Bet per selection"
                            unit={tokenSymbol}
                            surface="game"
                            containerClassName="w-full"
                            type="text"
                            inputMode="decimal"
                            placeholder={formattedMinBet}
                            value={currentBetAmount}
                            onChange={(e) => handleCurrentBetAmountChange(e.target.value)}
                            min={formattedMinBet}
                            step="any"
                            disabled={bettingInputDisabled}
                        />
                        {config && tokenDecimals !== undefined && (
                            <span className="text-xs text-white/75 [overflow-wrap:anywhere]">
                                Minimum per selection: {formatUnits(uiMinBet, tokenDecimals)} {tokenSymbol}. Maximum total stake: {formatUnits(offeredMaxBet, tokenDecimals)} {tokenSymbol}.
                            </span>
                        )}
                        {balanceData && (
                            <span className={`inline-flex items-center gap-1 text-xs ml-auto font-medium ${isInsufficientBalance ? 'text-red-400' : 'text-white/80'}`}>
                                <span>Bal:</span>
                                <Image src={tokenLogo} alt={tokenSymbol} width={14} height={14} className="h-3.5 w-3.5 rounded-full" />
                                <span>{formatTokenAmount(balanceData.value, balanceData.decimals)} {tokenSymbol}</span>
                            </span>
                        )}
                    </div>
                    {!pendingGame && draftExceedsLimit && <p className="text-sm text-amber-100" role="status">Adding this amount would exceed the current maximum total stake. Your amount has been kept so you can adjust it.</p>}
                    {!payoutsReady && <div className="space-y-2 text-center text-sm text-amber-100" role="status">
                        <p>{payoutsError ? 'Roulette payout rules could not be verified. New bets are paused.' : 'Checking Roulette payout rules...'}</p>
                        {payoutsError && <Button variant="outline" size="compact" onClick={() => void refetchPayouts()}>Retry payout rules</Button>}
                    </div>}
                    {configReadStatus !== 'ready' && (
                        <div className="space-y-2 text-center text-sm text-amber-100" role="status">
                            <p>{configReadStatus === 'error' ? 'Roulette game details could not be verified. Your current round and selections are retained.' : 'Checking Roulette game details...'}</p>
                            {configReadStatus === 'error' && <Button type="button" variant="outline" size="compact" onClick={() => void refreshCasinoState()}>Retry game details</Button>}
                        </div>
                    )}
                    {configReadStatus === 'ready' && !metadataReady && (
                        <div className="space-y-2 text-center text-sm text-amber-100" role="status">
                            <p>{metadataError ? 'Token details could not be verified. Betting is paused.' : 'Checking token details...'}</p>
                            {metadataError && <Button type="button" variant="outline" size="compact" onClick={() => void refetchMetadata()}>Retry token details</Button>}
                        </div>
                    )}
                    {configReadStatus === 'ready' && metadataReady && !pendingGame && payoutPoolReadStatus !== 'ready' && (
                        <div className="mt-2 space-y-2 text-center text-xs text-amber-200" role="status">
                            <p>{payoutPoolReadStatus === 'error'
                                ? 'Reward pool liquidity could not be verified. Retry before placing a bet.'
                                : 'Checking reward pool liquidity before enabling bets...'}</p>
                            {payoutPoolReadStatus === 'error' && (
                                <Button type="button" variant="outline" size="compact" onClick={retryPayoutPool}>
                                    Retry reward pool read
                                </Button>
                            )}
                        </div>
                    )}
                    {!pendingGame && tokenDecimals !== undefined && payoutPoolReadStatus === 'ready' && (poolLiquidityBinds || selectedBetsExceedPool) && (
                        <p className="mt-2 text-center text-xs text-amber-200" role="alert">
                            {selectedBetsExceedPool
                                ? `Selected bets could require ${bestPossibleWinDisplay} ${tokenSymbol}, above the ${formatCasinoLimit(payoutPoolBalance ?? BigInt(0), tokenDecimals)} ${tokenSymbol} reward pool.`
                                : `Reward pool liquidity limits the max stake to ${formattedMaxBet} ${tokenSymbol}.`}
                        </p>
                    )}

                    {!pendingGame && !isSpinning && selectedBetsOutsideLimits && <p role="status" className="text-sm text-amber-100">The limits changed. Your selections are kept; remove or adjust bets to meet the current minimum and total stake limit.</p>}
                    <RouletteBettingTable bettingInputDisabled={bettingInputDisabled} addBet={addBet} hasBet={hasBet} payouts={payouts} stakeLabel={currentStakeLabel} />

                </div>
                <DialogFooter sticky className="block space-y-2 mt-auto border-white/15 bg-black bg-none text-white">
                    {revealModeActive ? (
                        <CasinoTransaction mode="reveal" landId={landId} buttonText={revealButtonText} buttonClassName="w-full" disabled={revealButtonDisabled} onStatusUpdate={handleStatusUpdate} onComplete={handleRevealComplete} onButtonClick={handleRevealButtonClick} tokenSymbol={tokenSymbol} tokenDecimals={tokenDecimals} bettingToken={activeBet?.bettingToken ?? config?.bettingToken ?? null} />
                    ) : !metadataReady || tokenDecimals === undefined || configReadStatus !== 'ready' ? (
                        <Button className="w-full" disabled variant="secondary">{configReadStatus === 'error' ? 'Game details unavailable' : metadataError ? 'Token details unavailable' : 'Checking game details...'}</Button>
                    ) : !payoutsReady ? (
                        <Button className="w-full" disabled>{payoutsError ? 'Payout rules unavailable' : 'Checking payout rules...'}</Button>
                    ) : !pendingGame && config && !config.enabled ? (
                        <Button className="w-full" disabled variant="secondary">
                            Roulette disabled
                        </Button>
                    ) : !pendingGame && payoutPoolReadStatus !== 'ready' ? (
                        <Button className="w-full" disabled variant="secondary">
                            {payoutPoolReadStatus === 'error' ? 'Reward pool unavailable' : 'Checking reward pool...'}
                        </Button>
                    ) : !pendingGame && selectedBetsExceedPool ? (
                        <Button className="w-full" disabled variant="secondary">
                            Reward pool cannot cover selected bets
                        </Button>
                    ) : !pendingGame && !isSpinning && selectedBetsOutsideLimits ? (
                        <Button className="w-full" disabled>Adjust selected bets</Button>
                    ) : !hasApproval ? (
                        <ApproveTransaction spenderAddress={LAND_CONTRACT_ADDRESS} tokenAddress={config?.bettingToken as `0x${string}`} onSuccess={() => refreshApproval(true)} buttonText={`Approve ${tokenSymbol}`} buttonClassName="w-full" />
                    ) : isInsufficientBalance && !pendingGame ? (
                        <Button className="w-full" disabled variant="destructive">
                            Insufficient Balance
                        </Button>
                    ) : placedBets.length === 0 ? (
                        <Button className="w-full" disabled>
                            Select bets
                        </Button>
                    ) : (
                        <CasinoTransaction
                            mode="placeBets"
                            landId={landId}
                            betTypes={betTypes}
                            betNumbersArray={betNumbersArray}
                            betAmounts={betAmounts}
                            buttonText={isSpinning ? 'Placing...' : `Spin (${totalBetAmountDisplay} ${tokenSymbol})`}
                            buttonClassName="w-full"
                            disabled={isSpinning || hasUnsupportedZeroCombo}
                            onStatusUpdate={handleStatusUpdate}
                            onComplete={handlePlaceBetsComplete}
                            onButtonClick={handleSpinButtonClick}
                            tokenSymbol={tokenSymbol}
                            tokenDecimals={tokenDecimals}
                            bettingToken={config?.bettingToken ?? null}
                        />
                    )}
                    {hasUnsupportedZeroCombo && !pendingGame && (
                        <p className="text-center text-xs text-destructive">
                            Only straight bets can include 0.
                        </p>
                    )}
                    {pendingGame && !isSpinning && !canRevealActiveBet && activeBetBelongsToWallet && (
                        <p className="text-center text-xs text-white/70">
                            {revealBlocksRemaining > 0
                                ? `Reveal unlocks in ${revealBlocksRemaining} block${revealBlocksRemaining === 1 ? '' : 's'}.`
                                : 'Waiting for the reveal block to be indexed.'}
                        </p>
                    )}
                    {pendingGame && !activeBetBelongsToWallet && (
                        <p className="text-center text-xs text-destructive">
                            {address
                                ? 'This roulette game was started by another wallet.'
                                : 'Connect the wallet that started this roulette game.'}
                        </p>
                    )}
                    {error && <p className="text-center text-xs text-destructive">{error}</p>}
                </DialogFooter>
            </CasinoGameSurface>
        </Dialog>
    );
}
