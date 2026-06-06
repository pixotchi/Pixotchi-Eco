"use client";

import type { LifecycleStatus } from '@/components/transactions/transaction-kit';
import EuropeanRouletteWheel from '@/components/ui/EuropeanRouletteWheel';
import { Button } from '@/components/ui/button';
import { Dialog,DialogContent,DialogDescription,DialogFooter,DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useTokenMetadata } from '@/hooks/useTokenMetadata';
import { loadBetPreference,storeBetPreference } from '@/lib/casino-bet-preferences';
import { getClientCasinoPolicy } from '@/lib/casino-client';
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
import { formatTokenAmount,formatTokenAmountRounded,getCasinoTokenImage } from '@/lib/utils';
import { BET_TYPE_NAMES,CASINO_PAYOUT_MULTIPLIERS,CasinoBetType,RED_NUMBERS } from '@/public/abi/casino-abi';
import { Loader2,Trash2,X } from 'lucide-react';
import Image from 'next/image';
import { useCallback,useEffect,useId,useMemo,useRef,useState } from 'react';
import { toast } from 'react-hot-toast';
import { formatUnits,parseUnits } from 'viem';
import { useAccount,useBalance,useBlockNumber } from 'wagmi';
import ApproveTransaction from './approve-transaction';
import CasinoTransaction from './casino-transaction';

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
    payout: string;
}

const MAX_TOKEN_APPROVAL = BigInt('115792089237316195423570985008687907853269984665640564039457584007913129639935');
const APPROVAL_REFRESH_DELAYS_MS = [0, 750, 1500, 3000] as const;
const ACTIVE_BET_REFRESH_DELAYS_MS = [0, 1500, 4000] as const;
const ROULETTE_NUMBER_BUTTON_CLASS =
    "flex h-12 w-full items-center justify-center rounded-sm border border-white/10 text-xs font-bold text-white transition-all md:h-14 md:text-sm";
const ROULETTE_COLUMN_BUTTON_CLASS =
    "flex h-full w-full items-center justify-center rounded-r-sm border border-white/20 bg-black/40 text-xs font-bold text-white hover:bg-black/60";
const ROULETTE_OUTSIDE_BUTTON_CLASS =
    "flex h-11 min-h-11 items-center justify-center rounded-sm border border-white/20 bg-black/40 px-1 text-xs font-bold text-white hover:bg-black/60";
const ROULETTE_SELECTED_AREA_CLASS = "ring-2 inset-1 ring-primary bg-primary/40";
const ROULETTE_FAILURE_STATUSES = new Set([
    'error',
    'failed',
    'reverted',
    'cancelled',
    'canceled',
    'rejected',
    'transactionRejected',
    'userRejected',
    'buildError',
]);
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function getRouletteBetLabel(type: CasinoBetType, numbers: number[]): string {
    const sortedNumbers = [...numbers].sort((a, b) => a - b);

    switch (type) {
        case CasinoBetType.STRAIGHT:
            return `${sortedNumbers[0] ?? 0}`;
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

export default function CasinoDialog({ open, onOpenChange, landId, onSpinComplete, selectedToken }: CasinoDialogProps) {
    const { address } = useAccount();
    const casinoPolicy = getClientCasinoPolicy();
    const betAmountInputId = useId();

    const [placedBets, setPlacedBets] = useState<PlacedBet[]>([]);
    const [currentBetAmount, setCurrentBetAmount] = useState('10');
    const [isSpinning, setIsSpinning] = useState(false);
    const [spinPhase, setSpinPhase] = useState<'idle' | 'betting' | 'waiting' | 'revealing'>('idle');
    const [result, setResult] = useState<{ number: number; won: boolean; payout: string } | null>(null);
    // European wheel state
    const [wheelSpinning, setWheelSpinning] = useState(false);
    const [wheelWinningNumber, setWheelWinningNumber] = useState<number | null>(null);
    const [expiredResult, setExpiredResult] = useState<{ forfeitedAmount: string } | null>(null);
    const [config, setConfig] = useState<{ minBet: bigint; maxBet: bigint; bettingToken: string; enabled: boolean; maxBetsPerGame: number } | null>(null);
    const [allowanceWei, setAllowanceWei] = useState(BigInt(0));
    const [error, setError] = useState<string | null>(null);
    const [pendingGame, setPendingGame] = useState<boolean>(false);
    const [activeBet, setActiveBet] = useState<CasinoActiveBetV2 | null>(null);
    const [walletTxPending, setWalletTxPending] = useState(false);
    const revealAttemptRef = useRef(false);

    const { symbol: tokenSymbolRaw, decimals: tokenDecimals } = useTokenMetadata(config?.bettingToken);
    const tokenSymbol = tokenSymbolRaw || 'TOKEN';
    const formattedMinBet = useMemo(() => (
        config ? formatTokenAmountRounded(config.minBet, tokenDecimals) : '0'
    ), [config, tokenDecimals]);
    const formattedMaxBet = useMemo(() => (
        config ? formatTokenAmountRounded(config.maxBet, tokenDecimals) : '0'
    ), [config, tokenDecimals]);
    const tokenLogo = useMemo(() => getCasinoTokenImage(config?.bettingToken), [config?.bettingToken]);
    const betInputWidth = useMemo(() => {
        const visibleChars = Math.max(currentBetAmount.length, formattedMinBet.length, 4);
        return `calc(${Math.min(visibleChars + 1, 18)}ch + 1.25rem)`;
    }, [currentBetAmount, formattedMinBet]);

    const { data: balanceData, refetch: refetchBalance } = useBalance({
        address: address,
        token: config?.bettingToken as `0x${string}` | undefined,
        query: { enabled: !!address && !!config?.bettingToken }
    });
    const { data: liveBlock } = useBlockNumber({
        watch: open && pendingGame,
        query: {
            enabled: open && pendingGame,
            refetchInterval: open && pendingGame ? 3000 : false,
        },
    });

    const totalBetAmount = useMemo(() => {
        return placedBets.reduce((sum, bet) => sum + parseFloat(bet.amount || '0'), 0);
    }, [placedBets]);
    const totalBetWei = useMemo(() => {
        try {
            return placedBets.reduce((sum, bet) => sum + parseUnits(bet.amount || '0', tokenDecimals), BigInt(0));
        } catch {
            return BigInt(0);
        }
    }, [placedBets, tokenDecimals]);
    const requiredApprovalWei = useMemo(() => {
        if (!config) return BigInt(0);
        if (pendingGame || spinPhase === 'waiting' || spinPhase === 'revealing') return BigInt(0);
        if (totalBetWei > BigInt(0)) return totalBetWei;
        return config.minBet;
    }, [config, pendingGame, spinPhase, totalBetWei]);
    const hasApproval = allowanceWei >= requiredApprovalWei;

    // Calculate max win using the same zero handling as the contract.
    const bestPossibleWin = useMemo(() => {
        if (placedBets.length === 0) return 0;

        let maxPayout = 0;
        for (let num = 0; num <= 36; num++) {
            let payoutForThisNumber = 0;
            for (const bet of placedBets) {
                const amount = parseFloat(bet.amount || '0');
                if (rouletteBetWins(bet.type, bet.numbers, num)) {
                    const multiplier = CASINO_PAYOUT_MULTIPLIERS[bet.type];
                    payoutForThisNumber += amount + (amount * multiplier);
                }
            }
            if (payoutForThisNumber > maxPayout) maxPayout = payoutForThisNumber;
        }
        return maxPayout;
    }, [placedBets]);

    const balanceVal = balanceData ? parseFloat(formatUnits(balanceData.value, balanceData.decimals)) : 0;
    const isInsufficientBalance = totalBetAmount > balanceVal;
    const maxBets = config?.maxBetsPerGame || 2;
    const canAddMoreBets = placedBets.length < maxBets;
    const bettingLocked = pendingGame || spinPhase === 'waiting' || spinPhase === 'revealing' || isSpinning;
    const activeBetBelongsToWallet = !activeBet?.isActive || (!!address && activeBet.player.toLowerCase() === address.toLowerCase());
    const canRevealActiveBet = activeBetBelongsToWallet && rouletteCanReveal(activeBet, liveBlock);
    const revealBlocksRemaining = useMemo(() => {
        return rouletteRevealBlocksRemaining(activeBet, liveBlock);
    }, [activeBet, liveBlock]);
    const hasUnsupportedZeroCombo = useMemo(
        () => placedBets.some((bet) => rouletteHasUnsupportedZeroCombo(bet.type, bet.numbers)),
        [placedBets]
    );

    useEffect(() => {
        if (!open || casinoPolicy.playable) return;
        onOpenChange(false);
        toast.error(casinoPolicy.message || 'Casino is currently unavailable.');
    }, [casinoPolicy.message, casinoPolicy.playable, onOpenChange, open]);

    const refreshCasinoState = useCallback(async (options?: { keepPendingWhenMissing?: boolean }) => {
        if (!casinoPolicy.playable) return null;
        try {
            const activeGame = landId ? await casinoGetActiveBetV2(landId) : null;
            const effectiveToken = activeGame?.isActive ? activeGame.bettingToken : selectedToken;

            if (!effectiveToken) {
                setConfig(null);
                setPendingGame(false);
                setActiveBet(null);
                setAllowanceWei(BigInt(0));
                return activeGame;
            }

            const tokenConfig = await casinoGetTokenConfig(effectiveToken);
            if (tokenConfig?.supported || activeGame?.isActive) {
                setConfig({
                    minBet: tokenConfig?.minBet ?? BigInt(0),
                    maxBet: tokenConfig?.maxBet ?? BigInt(0),
                    bettingToken: effectiveToken,
                    enabled: tokenConfig?.enabled ?? false,
                    maxBetsPerGame: Number(tokenConfig?.maxBetsPerGame ?? BigInt(2)) || 2,
                });
            } else {
                setConfig(null);
            }

            if (activeGame?.isActive) {
                setPendingGame(true);
                setActiveBet(activeGame);
                setSpinPhase(activeGame.canReveal || activeGame.isExpired ? 'revealing' : 'waiting');
                const activeBetCount = Number(activeGame.numBets);
                if (activeBetCount > 0) {
                    const details = await Promise.all(
                        Array.from({ length: activeBetCount }, (_, index) => casinoGetBetDetails(landId, index))
                    );
                    const hydratedBets = details.flatMap((detail, index): PlacedBet[] => {
                        if (!detail) return [];
                        const type = Number(detail.betType) as CasinoBetType;
                        const numbers = detail.betNumbers.map(Number);
                        return [{
                            id: `active-${landId.toString()}-${index}`,
                            type,
                            label: getRouletteBetLabel(type, numbers),
                            numbers,
                            amount: formatTokenAmountRounded(detail.betAmount, tokenDecimals),
                            payout: `${CASINO_PAYOUT_MULTIPLIERS[type]}:1`,
                        }];
                    });
                    if (hydratedBets.length > 0) {
                        setPlacedBets(hydratedBets);
                        setCurrentBetAmount(hydratedBets[0].amount);
                    }
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

            if (address) {
                const approval = await checkCasinoApproval(address, effectiveToken);
                setAllowanceWei(approval);
            } else {
                setAllowanceWei(BigInt(0));
            }

            return activeGame;
        } catch (e) {
            console.error('Failed to load casino config:', e);
            return null;
        }
    }, [address, casinoPolicy.playable, landId, selectedToken, tokenDecimals]);

    useEffect(() => {
        if (open) void refreshCasinoState();
    }, [open, refreshCasinoState]);

    useEffect(() => {
        if (!open || !pendingGame || activeBet?.isActive || isSpinning) return;

        const intervalId = window.setInterval(() => {
            void refreshCasinoState({ keepPendingWhenMissing: true });
        }, 4000);

        return () => window.clearInterval(intervalId);
    }, [activeBet?.isActive, isSpinning, open, pendingGame, refreshCasinoState]);

    useEffect(() => {
        if (!open || !pendingGame || !activeBet?.isActive || isSpinning) return;

        const intervalId = window.setInterval(() => {
            void refreshCasinoState();
        }, 4000);

        return () => window.clearInterval(intervalId);
    }, [activeBet?.isActive, isSpinning, open, pendingGame, refreshCasinoState]);

    useEffect(() => {
        if (!pendingGame || !activeBet?.isActive || isSpinning) return;
        setSpinPhase(canRevealActiveBet ? 'revealing' : 'waiting');
    }, [activeBet?.isActive, canRevealActiveBet, isSpinning, pendingGame]);

    const configBettingToken = config?.bettingToken ?? null;
    const configMinBet = config?.minBet ?? null;
    const configMaxBet = config?.maxBet ?? null;
    const configMaxBetsPerGame = config?.maxBetsPerGame ?? null;

    useEffect(() => {
        if (!open || pendingGame || !configBettingToken) return;
        setPlacedBets([]);
        setError(null);
    }, [configBettingToken, configMinBet, configMaxBet, configMaxBetsPerGame, open, pendingGame]);

    useEffect(() => {
        if (!open || pendingGame || !configBettingToken || configMinBet === null || configMaxBet === null) return;
        setCurrentBetAmount(loadBetPreference({
            game: 'roulette',
            token: configBettingToken,
            minBet: configMinBet,
            maxBet: configMaxBet,
            decimals: tokenDecimals,
            fallback: formattedMinBet,
        }));
    }, [configBettingToken, configMinBet, configMaxBet, open, pendingGame, tokenDecimals, formattedMinBet]);

    useEffect(() => {
        if (!configBettingToken) return;
        storeBetPreference('roulette', configBettingToken, currentBetAmount, tokenDecimals);
    }, [configBettingToken, currentBetAmount, tokenDecimals]);

    // Callback when wheel animation ends
    const handleWheelSpinEnd = useCallback(() => {
        setWheelSpinning(false);
    }, []);

    const addBet = useCallback((type: CasinoBetType, label: string, numbers: number[]) => {
        if (bettingLocked) {
            toast.error('Finish the current spin before changing bets');
            return;
        }
        if (config && !config.enabled && !pendingGame) {
            toast.error('Roulette is currently disabled');
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
                const amountVal = parseUnits(currentBetAmount, tokenDecimals);

                // Min check (per bet)
                if (amountVal < config.minBet) {
                    toast.error(`Minimum bet is ${formattedMinBet} ${tokenSymbol}`);
                    return;
                }

                // Max check (Total Wager)
                const currentTotal = placedBets.reduce((acc, b) => acc + parseUnits(b.amount, tokenDecimals), BigInt(0));
                const projectedTotal = currentTotal + amountVal;

                if (projectedTotal > config.maxBet) {
                    const remaining = config.maxBet - currentTotal;
                    toast.error(`Total bet limit is ${formattedMaxBet} ${tokenSymbol}. You can add max ${formatTokenAmountRounded(remaining > BigInt(0) ? remaining : BigInt(0), tokenDecimals)} ${tokenSymbol}`);
                    return;
                }
            } catch {
                toast.error('Invalid bet amount');
                return;
            }
        }

        const exists = placedBets.some(b => b.type === type && JSON.stringify([...b.numbers].sort()) === JSON.stringify([...numbers].sort()));
        if (exists) { toast.error('Bet already placed'); return; }
        const newBet: PlacedBet = { id: `${Date.now()}-${Math.random()}`, type, label, numbers, amount: currentBetAmount, payout: `${CASINO_PAYOUT_MULTIPLIERS[type]}:1` };
        setResult(null);
        setExpiredResult(null);
        setError(null);
        setPlacedBets(prev => [...prev, newBet]);
        toast.success(`Added ${label} bet`);
    }, [bettingLocked, canAddMoreBets, currentBetAmount, maxBets, placedBets, config, tokenDecimals, tokenSymbol, pendingGame, formattedMaxBet, formattedMinBet]);

    const removeBet = useCallback((id: string) => { setPlacedBets(prev => prev.filter(b => b.id !== id)); }, []);
    const clearBets = useCallback(() => { setPlacedBets([]); }, []);

    const hasBet = useCallback((type: CasinoBetType, numbers: number[]) => {
        return placedBets.some(b => b.type === type && JSON.stringify([...b.numbers].sort()) === JSON.stringify([...numbers].sort()));
    }, [placedBets]);

    // Prepare bet data for CasinoTransaction
    const betTypes = useMemo(() => placedBets.map(b => b.type), [placedBets]);
    const betNumbersArray = useMemo(() => placedBets.map(b => b.numbers), [placedBets]);
    const betAmounts = useMemo(() => placedBets.map(b => parseUnits(b.amount, tokenDecimals)), [placedBets, tokenDecimals]);

    // Handle place bets completion
    const syncPlacedRouletteState = useCallback(async () => {
        for (const delayMs of ACTIVE_BET_REFRESH_DELAYS_MS) {
            if (delayMs > 0) await wait(delayMs);
            const latestActiveBet = await refreshCasinoState({ keepPendingWhenMissing: true });
            if (latestActiveBet?.isActive) {
                setError(null);
                return;
            }
        }

        setError('Bet was submitted. Waiting for the onchain game state to catch up...');
    }, [refreshCasinoState]);

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
        void syncPlacedRouletteState();
    }, [syncPlacedRouletteState]);

    // Handle reveal completion
    const handleRevealComplete = useCallback((result?: { winningNumber?: number; won?: boolean; payout?: string; expired?: boolean; forfeitedAmount?: string; receiptIncomplete?: boolean; transactionHash?: string }) => {
        const shouldProcess = revealAttemptRef.current || pendingGame || spinPhase === 'revealing' || isSpinning;
        if (!shouldProcess) return;

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

        if (result.expired) {
            setError(null);
            setResult(null);
            setExpiredResult({ forfeitedAmount: result.forfeitedAmount ?? '0' });
            setWheelSpinning(false);
            refetchBalance();
            setPendingGame(false);
            setActiveBet(null);
            setPlacedBets([]);
            onSpinComplete?.();
            return;
        }

        if (result.winningNumber !== undefined) {
            setError(null); // Clear any errors on success
            setExpiredResult(null);
            setResult({
                number: result.winningNumber,
                won: result.won ?? false,
                payout: result.payout ?? '0'
            });
            setWheelWinningNumber(result.winningNumber);
            refetchBalance();
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
            for (const delayMs of ACTIVE_BET_REFRESH_DELAYS_MS) {
                if (delayMs > 0) await wait(delayMs);
                const latestActiveBet = await casinoGetActiveBetV2(landId);

                if (!latestActiveBet?.isActive) {
                    setPendingGame(false);
                    setActiveBet(null);
                    setPlacedBets([]);
                    setSpinPhase('idle');
                    setError('Spin completed. Check recent activity for the result.');
                    refetchBalance();
                    onSpinComplete?.();
                    return;
                }

                setPendingGame(true);
                setActiveBet(latestActiveBet);
                setSpinPhase(latestActiveBet.canReveal || latestActiveBet.isExpired ? 'revealing' : 'waiting');
            }

            setError('Reveal was submitted, but the game still appears active. Try revealing again after the next refresh.');
        })();
    }, [isSpinning, landId, onSpinComplete, pendingGame, refetchBalance, refreshCasinoState, spinPhase]);

    // Handle transaction status updates for UI feedback
    const handleStatusUpdate = useCallback((status: LifecycleStatus) => {
        if (status.statusName === 'transactionPending') {
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
        if (ROULETTE_FAILURE_STATUSES.has(status.statusName ?? '')) {
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
            toast.error('Transaction submitted. Please wait for confirmation.');
            return;
        }

        if (pendingGame) {
            toast('Roulette game remains active onchain. Reopen Casino to reveal or settle it.');
        }

        setIsSpinning(false);
        setWheelSpinning(false);
        setSpinPhase(pendingGame ? 'waiting' : 'idle');
        onOpenChange(false);
    }, [onOpenChange, pendingGame, walletTxPending]);

    // Button click handler to start spinning immediately
    const handleSpinButtonClick = useCallback(() => {
        if (hasUnsupportedZeroCombo) {
            setError('Only straight bets can include 0.');
            return;
        }
        setSpinPhase('betting');
        setError(null);
        setResult(null);
        setExpiredResult(null);
        setWheelWinningNumber(null);
        setWheelSpinning(true);
    }, [hasUnsupportedZeroCombo]);

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
        if (!address || !config?.bettingToken) return;

        if (optimistic) {
            setAllowanceWei(MAX_TOKEN_APPROVAL);
        }

        let latestAllowance = BigInt(0);
        for (const delayMs of APPROVAL_REFRESH_DELAYS_MS) {
            if (delayMs > 0) await wait(delayMs);

            const approval = await checkCasinoApproval(address, config.bettingToken);
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
    }, [address, config?.bettingToken, requiredApprovalWei]);

    const getNumberColor = (n: number): string => n === 0 ? 'bg-green-600' : RED_NUMBERS.includes(n) ? 'bg-red-600' : 'bg-gray-900';

    // Render a number cell with optional edge hitboxes
    const renderNumberCell = (num: number, rowIndex: 0 | 1 | 2, colIndex: number) => {
        const isRed = RED_NUMBERS.includes(num);
        const isTop = rowIndex === 0; // Row with 3,6,9...
        const isBottom = rowIndex === 2; // Row with 1,4,7...
        const isLastCol = colIndex === 11;

        // Calculate adjacent numbers for complex bets
        const numBelow = num - 1; // e.g., if num=2, below=1
        const numRight = num + 3; // e.g., if num=3, right=6

        // Street numbers (vertical column of 3)
        const streetBase = Math.floor((num - 1) / 3) * 3 + 1;
        const streetNums = [streetBase, streetBase + 1, streetBase + 2];

        // Six-line (6 numbers - two streets)
        const sixLineNums = [...streetNums, streetBase + 3, streetBase + 4, streetBase + 5];

        return (
            <div key={num} className="relative w-full h-full">
                {/* Main number button - Fill container */}
                <button
                    type="button"
                    onClick={() => addBet(CasinoBetType.STRAIGHT, `${num}`, [num])}
                    aria-label={`Bet straight on ${num}`}
                    className={`${ROULETTE_NUMBER_BUTTON_CLASS}
                        ${hasBet(CasinoBetType.STRAIGHT, [num]) ? 'ring-2 ring-amber-400 z-10' : 'hover:brightness-110'}
                        ${isRed ? 'bg-red-600' : 'bg-gray-900'}`}
                >
                    {num}
                </button>

                {/* Street bet hitbox - Top Edge Center */}
                {isTop && (
                    <button
                        type="button"
                        aria-label={`Bet street ${streetNums[0]} to ${streetNums[2]}`}
                        className="absolute top-0 left-1/2 z-20 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#07120d] group"
                        onClick={(e) => { e.stopPropagation(); addBet(CasinoBetType.STREET, `Street ${streetNums[0]}-${streetNums[2]}`, streetNums); }}
                    >
                        <div className={`w-6 h-2 rounded-full transition-all shadow-sm ${hasBet(CasinoBetType.STREET, streetNums) ? 'bg-purple-500 ring-1 ring-white' : 'hover:bg-purple-400/70'}`} />
                    </button>
                )}

                {/* Horizontal split hitbox - Bottom Edge Center */}
                {!isBottom && (
                    <button
                        type="button"
                        aria-label={`Bet split ${numBelow} and ${num}`}
                        className="absolute bottom-0 left-1/2 z-20 flex h-11 w-11 -translate-x-1/2 translate-y-1/2 cursor-pointer items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#07120d] group"
                        onClick={(e) => { e.stopPropagation(); addBet(CasinoBetType.SPLIT, `Split ${numBelow}-${num}`, [numBelow, num]); }}
                    >
                        <div className={`w-3 h-3 rounded-full transition-all shadow-sm ${hasBet(CasinoBetType.SPLIT, [numBelow, num]) ? 'bg-amber-400 ring-1 ring-white' : 'hover:bg-white/60'}`} />
                    </button>
                )}

                {/* Vertical split hitbox - Right Edge Center */}
                {!isLastCol && (
                    <button
                        type="button"
                        aria-label={`Bet split ${num} and ${numRight}`}
                        className="absolute right-0 top-1/2 z-20 flex h-11 w-11 -translate-y-1/2 translate-x-1/2 cursor-pointer items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#07120d] group"
                        onClick={(e) => { e.stopPropagation(); addBet(CasinoBetType.SPLIT, `Split ${num}-${numRight}`, [num, numRight]); }}
                    >
                        <div className={`w-3 h-3 rounded-full transition-all shadow-sm ${hasBet(CasinoBetType.SPLIT, [num, numRight]) ? 'bg-amber-400 ring-1 ring-white' : 'hover:bg-white/60'}`} />
                    </button>
                )}

                {/* Corner hitbox - Bottom Right Corner */}
                {!isBottom && !isLastCol && (
                    <button
                        type="button"
                        aria-label={`Bet corner ${[numBelow, num, numBelow + 3, numRight].join(', ')}`}
                        className="absolute bottom-0 right-0 z-30 flex h-11 w-11 translate-x-1/2 translate-y-1/2 cursor-pointer items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#07120d] group"
                        onClick={(e) => {
                            e.stopPropagation();
                            const cornerSet = [numBelow, num, numBelow + 3, numRight];
                            addBet(CasinoBetType.CORNER, `Corner ${cornerSet.join(',')}`, cornerSet);
                        }}
                    >
                        <div className={`w-3 h-3 rounded-full transition-all shadow-sm ${hasBet(CasinoBetType.CORNER, [numBelow, num, numBelow + 3, numRight]) ? 'bg-blue-400 ring-1 ring-white' : 'hover:bg-blue-400/70'}`} />
                    </button>
                )}

                {/* Six-line hitbox - Top Right Corner */}
                {isTop && !isLastCol && (
                    <button
                        type="button"
                        aria-label={`Bet six line ${streetNums[0]} to ${streetNums[2] + 3}`}
                        className="absolute right-0 top-0 z-30 flex h-11 w-11 -translate-y-1/2 translate-x-1/2 cursor-pointer items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#07120d] group"
                        onClick={(e) => { e.stopPropagation(); addBet(CasinoBetType.SIX_LINE, `6-Line ${streetNums[0]}-${streetNums[2] + 3}`, sixLineNums); }}
                    >
                        <div className={`w-3 h-3 rounded-full transition-all shadow-sm ${hasBet(CasinoBetType.SIX_LINE, sixLineNums) ? 'bg-orange-400 ring-1 ring-white' : 'hover:bg-orange-400/70'}`} />
                    </button>
                )}
            </div>
        );
    };

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

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent
                hideCloseButton
                mobileMode="center"
                surface="game"
                size="full"
                stickyFooter
                className="casino-dialog-surface max-h-[calc(100dvh-1rem)] w-[min(96vw,60rem)] overflow-y-auto border-white/15 bg-[url('/icons/casino.png')] bg-cover bg-center bg-no-repeat p-3 sm:p-4 md:p-6"
            >
                <DialogTitle className="sr-only">Roulette</DialogTitle>
                <DialogDescription className="sr-only">
                    Roulette game dialog with betting controls, active spin state, reveal controls, and transaction status.
                </DialogDescription>
                <Button
                    type="button"
                    variant="ghost"
                    size="iconCompact"
                    onClick={() => handleClose(false)}
                    aria-label="Close Roulette dialog"
                    className="absolute right-2 top-2 z-50 h-10 min-h-10 w-10 min-w-10 border border-white/45 bg-black/70 text-white shadow-[0_8px_20px_rgba(0,0,0,0.45)] hover:bg-black/85 hover:text-white focus-visible:ring-white sm:right-3 sm:top-3"
                >
                    <X className="h-4 w-4" aria-hidden="true" />
                </Button>

                <div className="relative space-y-3 sm:space-y-4">
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
                                <div className={`px-3 py-1 rounded-full text-white font-bold text-xs shadow-lg ${getNumberColor(result.number)}`}>
                                    {result.number}
                                </div>
                            )}
                            {/* Spin Status */}
                            {(isSpinning || wheelSettling) && (
                                <div className="text-center text-sm text-white/90">
                                    <Loader2 className="inline h-4 w-4 animate-spin mr-2" />
                                    {wheelSettling
                                        ? 'Settling result...'
                                        : <>{spinPhase === 'betting' && 'Placing bets...'}{spinPhase === 'waiting' && 'Waiting for block...'}{spinPhase === 'revealing' && 'Revealing...'}</>}
                                </div>
                            )}
                        </div>

                        {/* Bets Panel - Right Side */}
                        <div className="w-full min-w-0">
                            <div className="h-full rounded-md border border-white/10 bg-black/35 p-2 text-white backdrop-blur-sm sm:p-2.5">
                                <div className="mb-1.5 flex items-center justify-between gap-2">
                                    <span className="text-xs font-semibold uppercase tracking-wide text-white/85">Bets {placedBets.length}/{maxBets}</span>
                                    {placedBets.length > 0 && (
                                        <Button
                                            variant="ghost"
                                            size="compact"
                                            onClick={clearBets}
                                            disabled={bettingLocked}
                                            className="h-7 min-h-7 px-2 text-xs text-white/80 hover:bg-white/10 hover:text-white"
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                            Clear
                                        </Button>
                                    )}
                                </div>
                                {placedBets.length === 0 ? (
                                    <p className="rounded border border-dashed border-white/15 bg-black/20 py-2 text-center text-xs text-white/60">Tap the table to add bets</p>
                                ) : (
                                    <div className="flex max-h-16 flex-wrap gap-1 overflow-y-auto pr-1 [scrollbar-width:thin]">
                                        {placedBets.map(bet => (
                                            <div key={bet.id} className="inline-flex min-w-0 shrink-0 items-center gap-1 rounded-full border border-white/15 bg-black/60 py-0.5 pl-2 pr-0.5 text-[11px] leading-none">
                                                <span className="max-w-[7rem] truncate font-medium text-white">{bet.label}</span>
                                                <span className="rounded-full bg-white/10 px-1.5 py-0.5 tabular-nums text-white/75">{bet.amount}</span>
                                                <button
                                                    type="button"
                                                    onClick={() => removeBet(bet.id)}
                                                    disabled={bettingLocked}
                                                    aria-label={`Remove ${bet.label} bet`}
                                                    className="inline-flex h-5 min-h-5 w-5 min-w-5 shrink-0 items-center justify-center rounded-full text-red-300/80 transition-colors hover:bg-red-500/20 hover:text-red-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-30"
                                                >
                                                    <X className="h-3 w-3" aria-hidden="true" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                {placedBets.length > 0 && (
                                    <div className="mt-2 grid grid-cols-2 gap-2 border-t border-white/10 pt-2 text-[11px]">
                                        <span>Total <strong className="inline-flex items-center gap-1"><Image src={tokenLogo} alt={tokenSymbol} width={14} height={14} className="h-3.5 w-3.5 rounded-full" />{totalBetAmount.toFixed(2)}</strong></span>
                                        <span className="text-right text-green-300">Max <strong className="inline-flex items-center gap-1"><Image src={tokenLogo} alt={tokenSymbol} width={14} height={14} className="h-3.5 w-3.5 rounded-full" />{bestPossibleWin.toFixed(2)}</strong></span>
                                    </div>
                                )}
                            </div>

                        </div>
                    </div>

                    {/* Round Result */}
                    {showRoundResult && result && (
                        <div
                            role="status"
                            aria-live="polite"
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
                                        <span>Payout</span>
                                        <Image src={tokenLogo} alt={tokenSymbol} width={16} height={16} className="h-4 w-4 rounded-full" />
                                        <span>{parseFloat(result.payout).toFixed(2)} {tokenSymbol}</span>
                                    </div>
                                ) : (
                                    <div className="rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white/75">
                                        Better luck next spin
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {showExpiredRoundResult && expiredResult && (
                        <div
                            role="status"
                            aria-live="polite"
                            className="relative z-0 rounded-[var(--radius-panel)] border border-yellow-300/40 bg-black/70 p-3 text-sm text-white shadow-[0_12px_32px_rgba(0,0,0,0.32)] backdrop-blur-md"
                        >
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                    <div className="text-[11px] font-semibold uppercase tracking-wide text-yellow-200/70">Round result</div>
                                    <div className="text-base font-bold leading-tight text-yellow-100">Bet expired</div>
                                </div>
                                <div className="inline-flex items-center gap-1.5 rounded-full border border-yellow-200/25 bg-yellow-400/10 px-3 py-1.5 font-bold text-yellow-100">
                                    <Image src={tokenLogo} alt={tokenSymbol} width={16} height={16} className="h-4 w-4 rounded-full" />
                                    <span>{parseFloat(expiredResult.forfeitedAmount).toFixed(2)} {tokenSymbol} forfeited</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Bet Amount */}
                    <div className="flex flex-wrap items-center gap-2">
                        <label htmlFor={betAmountInputId} className="text-xs font-medium text-white">Bet:</label>
                        <Input
                            id={betAmountInputId}
                            type="text"
                            inputMode="decimal"
                            value={currentBetAmount}
                            onChange={(e) => setCurrentBetAmount(e.target.value)}
                            className="h-11 min-h-11 min-w-[5.5rem] w-auto flex-none px-3 text-sm tabular-nums bg-black/40 border-white/20 text-white placeholder:text-white/50"
                            min={formattedMinBet}
                            step="any"
                            disabled={bettingLocked}
                            style={{ width: betInputWidth }}
                        />
                        <span className="inline-flex items-center gap-1 text-xs text-white/90 font-bold">
                            <Image src={tokenLogo} alt={tokenSymbol} width={16} height={16} className="h-4 w-4 rounded-full" />
                            {tokenSymbol}
                        </span>
                        {config && (
                            <span className="text-xs text-white/60">
                                Min: {formattedMinBet} | Max: {formattedMaxBet} {tokenSymbol}
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

                    {/* BETTING TABLE - Fully Responsive Fit */}
                    <div className="w-full select-none overflow-x-auto overscroll-x-contain pb-4 [scrollbar-width:thin]" aria-label="Roulette betting table">
                        <div className="mx-auto min-w-[520px] max-w-[820px] md:min-w-0">
                            {/* Numbers Grid */}
                            <div className="grid w-full grid-cols-[44px_repeat(12,minmax(32px,1fr))_44px] gap-[2px] rounded-lg bg-border p-[1px] md:grid-cols-[48px_repeat(12,1fr)_48px]">
                                {/* Zero - Spans 3 rows */}
                                <div className="row-span-3 h-full relative">
                                    <button
                                        type="button"
                                        onClick={() => addBet(CasinoBetType.STRAIGHT, '0', [0])}
                                        aria-label="Bet straight on 0"
                                        className={`flex h-full w-full items-center justify-center rounded-l-md border border-white/10 bg-green-600 text-xs font-bold text-white md:text-sm
                                            ${hasBet(CasinoBetType.STRAIGHT, [0]) ? 'ring-2 inset-2 ring-amber-400 z-10' : 'hover:brightness-110'}`}
                                    ><span className="-rotate-90">0</span></button>

                                </div>

                                {/* Row 3 (Top): 3, 6, 9... 36 */}
                                {[...Array(12)].map((_, i) => renderNumberCell((i * 3) + 3, 0, i))}

                                {/* 2to1 Column 3 */}
                                <button type="button" onClick={() => addBet(CasinoBetType.COLUMN, '3rd Col', [3])}
                                    aria-label="Bet third column"
                                    className={`${ROULETTE_COLUMN_BUTTON_CLASS}
                                        ${hasBet(CasinoBetType.COLUMN, [3]) ? ROULETTE_SELECTED_AREA_CLASS : ''}`}>
                                    <span className="-rotate-90">2:1</span>
                                </button>

                                {/* Row 2 (Mid): 2, 5, 8... 35 */}
                                {[...Array(12)].map((_, i) => renderNumberCell((i * 3) + 2, 1, i))}

                                {/* 2to1 Column 2 */}
                                <button type="button" onClick={() => addBet(CasinoBetType.COLUMN, '2nd Col', [2])}
                                    aria-label="Bet second column"
                                    className={`${ROULETTE_COLUMN_BUTTON_CLASS}
                                        ${hasBet(CasinoBetType.COLUMN, [2]) ? ROULETTE_SELECTED_AREA_CLASS : ''}`}>
                                    <span className="-rotate-90">2:1</span>
                                </button>

                                {/* Row 1 (Bottom): 1, 4, 7... 34 */}
                                {[...Array(12)].map((_, i) => renderNumberCell((i * 3) + 1, 2, i))}

                                {/* 2to1 Column 1 */}
                                <button type="button" onClick={() => addBet(CasinoBetType.COLUMN, '1st Col', [1])}
                                    aria-label="Bet first column"
                                    className={`${ROULETTE_COLUMN_BUTTON_CLASS}
                                        ${hasBet(CasinoBetType.COLUMN, [1]) ? ROULETTE_SELECTED_AREA_CLASS : ''}`}>
                                    <span className="-rotate-90">2:1</span>
                                </button>
                            </div>

                            {/* Dozens */}
                            <div className="mt-[2px] grid w-full grid-cols-[44px_repeat(3,1fr)_44px] gap-[2px] md:grid-cols-[48px_repeat(3,1fr)_48px]">
                                <div />
                                <button type="button" onClick={() => addBet(CasinoBetType.DOZEN, '1st 12', [1])} aria-label="Bet first twelve" className={`${ROULETTE_OUTSIDE_BUTTON_CLASS} ${hasBet(CasinoBetType.DOZEN, [1]) ? ROULETTE_SELECTED_AREA_CLASS : ''}`}>1st 12</button>
                                <button type="button" onClick={() => addBet(CasinoBetType.DOZEN, '2nd 12', [2])} aria-label="Bet second twelve" className={`${ROULETTE_OUTSIDE_BUTTON_CLASS} ${hasBet(CasinoBetType.DOZEN, [2]) ? ROULETTE_SELECTED_AREA_CLASS : ''}`}>2nd 12</button>
                                <button type="button" onClick={() => addBet(CasinoBetType.DOZEN, '3rd 12', [3])} aria-label="Bet third twelve" className={`${ROULETTE_OUTSIDE_BUTTON_CLASS} ${hasBet(CasinoBetType.DOZEN, [3]) ? ROULETTE_SELECTED_AREA_CLASS : ''}`}>3rd 12</button>
                                <div />
                            </div>

                            {/* Outside Bets */}
                            <div className="mt-[2px] grid w-full grid-cols-[44px_repeat(6,1fr)_44px] gap-[2px] md:grid-cols-[48px_repeat(6,1fr)_48px]">
                                <div />
                                <button type="button" onClick={() => addBet(CasinoBetType.LOW, '1-18', [])} aria-label="Bet one to eighteen" className={`${ROULETTE_OUTSIDE_BUTTON_CLASS} ${hasBet(CasinoBetType.LOW, []) ? ROULETTE_SELECTED_AREA_CLASS : ''}`}>1-18</button>
                                <button type="button" onClick={() => addBet(CasinoBetType.EVEN, 'EVEN', [])} aria-label="Bet even numbers" className={`${ROULETTE_OUTSIDE_BUTTON_CLASS} ${hasBet(CasinoBetType.EVEN, []) ? ROULETTE_SELECTED_AREA_CLASS : ''}`}>EVEN</button>
                                <button type="button" onClick={() => addBet(CasinoBetType.RED, 'RED', [])} aria-label="Bet red numbers" className={`flex h-11 min-h-11 items-center justify-center rounded-sm border border-white/10 bg-red-600 px-1 text-xs font-bold text-white ${hasBet(CasinoBetType.RED, []) ? 'ring-2 inset-1 ring-amber-400' : 'hover:brightness-110'}`}>RED</button>
                                <button type="button" onClick={() => addBet(CasinoBetType.BLACK, 'BLACK', [])} aria-label="Bet black numbers" className={`flex h-11 min-h-11 items-center justify-center rounded-sm border border-white/10 bg-gray-900 px-1 text-xs font-bold text-white ${hasBet(CasinoBetType.BLACK, []) ? 'ring-2 inset-1 ring-amber-400' : 'hover:brightness-110'}`}>BLACK</button>
                                <button type="button" onClick={() => addBet(CasinoBetType.ODD, 'ODD', [])} aria-label="Bet odd numbers" className={`${ROULETTE_OUTSIDE_BUTTON_CLASS} ${hasBet(CasinoBetType.ODD, []) ? ROULETTE_SELECTED_AREA_CLASS : ''}`}>ODD</button>
                                <button type="button" onClick={() => addBet(CasinoBetType.HIGH, '19-36', [])} aria-label="Bet nineteen to thirty-six" className={`${ROULETTE_OUTSIDE_BUTTON_CLASS} ${hasBet(CasinoBetType.HIGH, []) ? ROULETTE_SELECTED_AREA_CLASS : ''}`}>19-36</button>
                                <div />
                            </div>
                        </div>
                    </div>

                    {/* Bet Legend */}
                    <div className="flex flex-wrap justify-center gap-2 rounded-[var(--radius-control)] bg-black/20 p-2 text-xs font-medium text-white/80">
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-400" />Street</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-teal-400" />Trio</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-white/60" />Split</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400" />Corner</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-400" />6-Line</span>
                    </div>

                </div>
                <DialogFooter sticky className="block space-y-2 -bottom-3 -mx-3 -mb-3 border-white/15 bg-black/75 bg-none px-3 pt-3 text-white backdrop-blur-md sm:-bottom-4 sm:-mx-4 sm:-mb-4 sm:px-4 md:-bottom-6 md:-mx-6 md:-mb-6 md:px-6">
                    {!pendingGame && config && !config.enabled ? (
                        <Button className="w-full" disabled variant="secondary">
                            Roulette disabled
                        </Button>
                    ) : !hasApproval ? (
                        <ApproveTransaction spenderAddress={LAND_CONTRACT_ADDRESS} tokenAddress={config?.bettingToken as `0x${string}`} onSuccess={() => refreshApproval(true)} buttonText={`Approve ${tokenSymbol}`} buttonClassName="w-full" />
                    ) : isInsufficientBalance && !pendingGame ? (
                        <Button className="w-full" disabled variant="destructive">
                            Insufficient Balance
                        </Button>
                    ) : pendingGame || spinPhase === 'waiting' || spinPhase === 'revealing' ? (
                        <CasinoTransaction
                            mode="reveal"
                            landId={landId}
                            buttonText={revealButtonText}
                            buttonClassName="w-full"
                            disabled={revealButtonDisabled}
                            onStatusUpdate={handleStatusUpdate}
                            onComplete={handleRevealComplete}
                            onButtonClick={handleRevealButtonClick}
                            tokenSymbol={tokenSymbol}
                            tokenDecimals={tokenDecimals}
                        />
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
                            buttonText={isSpinning ? 'Placing...' : `Spin (${totalBetAmount.toFixed(2)} ${tokenSymbol})`}
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
            </DialogContent>
        </Dialog>
    );
}
