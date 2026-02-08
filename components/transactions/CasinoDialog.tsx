"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import EuropeanRouletteWheel from '@/components/ui/EuropeanRouletteWheel';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, X, Trash2 } from 'lucide-react';
import { parseUnits, formatUnits } from 'viem';
import { usePublicClient, useAccount, useBalance } from 'wagmi';
import {
    casinoGetActiveBet,
    casinoGetConfig,
    checkCasinoApproval,
    LAND_CONTRACT_ADDRESS,
    PIXOTCHI_TOKEN_ADDRESS,
} from '@/lib/contracts';
import { CasinoBetType, CASINO_PAYOUT_MULTIPLIERS, RED_NUMBERS } from '@/public/abi/casino-abi';
import ApproveTransaction from './approve-transaction';
import CasinoTransaction from './casino-transaction';
import { toast } from 'react-hot-toast';
import { useTokenSymbol } from '@/hooks/useTokenSymbol';
import { formatTokenAmount } from '@/lib/utils';
import { usePaymaster } from '@/lib/paymaster-context';
import { SponsoredBadge } from '@/components/paymaster-toggle';
import type { LifecycleStatus } from '@coinbase/onchainkit/transaction';

interface CasinoDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    landId: bigint;
    onSpinComplete?: () => void;
}

interface PlacedBet {
    id: string;
    type: CasinoBetType;
    label: string;
    numbers: number[];
    amount: string;
    payout: string;
}

export default function CasinoDialog({ open, onOpenChange, landId, onSpinComplete }: CasinoDialogProps) {
    const publicClient = usePublicClient();
    const { address } = useAccount();
    const { isSponsored } = usePaymaster();

    const [placedBets, setPlacedBets] = useState<PlacedBet[]>([]);
    const [currentBetAmount, setCurrentBetAmount] = useState('10');
    const [isSpinning, setIsSpinning] = useState(false);
    const [spinPhase, setSpinPhase] = useState<'idle' | 'betting' | 'waiting' | 'revealing'>('idle');
    const [result, setResult] = useState<{ number: number; won: boolean; payout: string } | null>(null);
    // European wheel state
    const [wheelSpinning, setWheelSpinning] = useState(false);
    const [wheelWinningNumber, setWheelWinningNumber] = useState<number | null>(null);
    const [config, setConfig] = useState<{ minBet: bigint; maxBet: bigint; bettingToken: string; enabled: boolean; maxBetsPerGame: number } | null>(null);
    const [allowanceWei, setAllowanceWei] = useState(BigInt(0));
    const [error, setError] = useState<string | null>(null);
    const [pendingGame, setPendingGame] = useState<boolean>(false);

    const { data: balanceData, refetch: refetchBalance } = useBalance({
        address: address,
        token: config?.bettingToken as `0x${string}` || PIXOTCHI_TOKEN_ADDRESS,
        query: { enabled: !!address }
    });

    const tokenSymbol = useTokenSymbol(config?.bettingToken) || 'SEED';

    const totalBetAmount = useMemo(() => {
        return placedBets.reduce((sum, bet) => sum + parseFloat(bet.amount || '0'), 0);
    }, [placedBets]);
    const totalBetWei = useMemo(() => {
        try {
            return placedBets.reduce((sum, bet) => sum + parseUnits(bet.amount || '0', 18), BigInt(0));
        } catch {
            return BigInt(0);
        }
    }, [placedBets]);
    const requiredApprovalWei = useMemo(() => {
        if (!config) return BigInt(0);
        if (pendingGame || spinPhase === 'waiting' || spinPhase === 'revealing') return BigInt(0);
        if (totalBetWei > BigInt(0)) return totalBetWei;
        return config.minBet;
    }, [config, pendingGame, spinPhase, totalBetWei]);
    const hasApproval = allowanceWei >= requiredApprovalWei;

    // Calculate CORRECT max win by simulating all 37 possible outcomes
    const bestPossibleWin = useMemo(() => {
        if (placedBets.length === 0) return 0;

        const doesBetWin = (bet: PlacedBet, winningNumber: number): boolean => {
            const { type, numbers } = bet;
            if (winningNumber === 0) {
                if (type === CasinoBetType.STRAIGHT && numbers.includes(0)) return true;
                if ([CasinoBetType.SPLIT, CasinoBetType.CORNER, CasinoBetType.STREET, CasinoBetType.SIX_LINE].includes(type)) {
                    return numbers.includes(0);
                }
                return false;
            }
            switch (type) {
                case CasinoBetType.STRAIGHT:
                case CasinoBetType.SPLIT:
                case CasinoBetType.CORNER:
                case CasinoBetType.STREET:
                case CasinoBetType.SIX_LINE:
                    return numbers.includes(winningNumber);
                case CasinoBetType.DOZEN: {
                    const dozen = numbers[0];
                    if (dozen === 1) return winningNumber >= 1 && winningNumber <= 12;
                    if (dozen === 2) return winningNumber >= 13 && winningNumber <= 24;
                    if (dozen === 3) return winningNumber >= 25 && winningNumber <= 36;
                    return false;
                }
                case CasinoBetType.COLUMN: {
                    const column = numbers[0];
                    return (winningNumber % 3) === (column % 3);
                }
                case CasinoBetType.RED: return RED_NUMBERS.includes(winningNumber);
                case CasinoBetType.BLACK: return !RED_NUMBERS.includes(winningNumber) && winningNumber !== 0;
                case CasinoBetType.ODD: return winningNumber % 2 === 1;
                case CasinoBetType.EVEN: return winningNumber % 2 === 0 && winningNumber !== 0;
                case CasinoBetType.LOW: return winningNumber >= 1 && winningNumber <= 18;
                case CasinoBetType.HIGH: return winningNumber >= 19 && winningNumber <= 36;
                default: return false;
            }
        };

        let maxPayout = 0;
        for (let num = 0; num <= 36; num++) {
            let payoutForThisNumber = 0;
            for (const bet of placedBets) {
                const amount = parseFloat(bet.amount || '0');
                if (doesBetWin(bet, num)) {
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

    useEffect(() => {
        const loadConfig = async () => {
            try {
                const cfg = await casinoGetConfig();
                const bettingToken = cfg?.bettingToken || PIXOTCHI_TOKEN_ADDRESS;
                if (cfg) {
                    setConfig({ minBet: cfg.minBet, maxBet: cfg.maxBet, bettingToken, enabled: cfg.enabled, maxBetsPerGame: Number(cfg.maxBetsPerGame) || 2 });
                }
                if (landId) {
                    try {
                        const activeGame = await casinoGetActiveBet(landId);
                        if (activeGame && activeGame.isActive) { setPendingGame(true); setSpinPhase('revealing'); }
                    } catch (e) { console.error('Failed to check active game:', e); }
                }
                if (address) {
                    const approval = await checkCasinoApproval(address, bettingToken);
                    setAllowanceWei(approval);
                }
            } catch (e) { console.error('Failed to load casino config:', e); }
        };
        if (open) loadConfig();
    }, [open, address, landId]);

    // Callback when wheel animation ends
    const handleWheelSpinEnd = useCallback(() => {
        setWheelSpinning(false);
    }, []);

    const addBet = useCallback((type: CasinoBetType, label: string, numbers: number[]) => {
        if (config && !config.enabled && !pendingGame) {
            toast.error('Roulette is currently disabled');
            return;
        }
        if (!canAddMoreBets) { toast.error(`Maximum ${maxBets} bets per spin`); return; }

        // Validate Min/Max Bet
        if (config) {
            try {
                const amountVal = parseUnits(currentBetAmount, 18); // assuming 18 decimals for now, or use token decimals if available

                // Min check (per bet)
                if (amountVal < config.minBet) {
                    toast.error(`Minimum bet is ${formatUnits(config.minBet, 18)} ${tokenSymbol}`);
                    return;
                }

                // Max check (Total Wager)
                const currentTotal = placedBets.reduce((acc, b) => acc + parseUnits(b.amount, 18), BigInt(0));
                const projectedTotal = currentTotal + amountVal;

                if (projectedTotal > config.maxBet) {
                    const remaining = config.maxBet - currentTotal;
                    toast.error(`Total bet limit is ${formatUnits(config.maxBet, 18)} ${tokenSymbol}. You can add max ${formatUnits(remaining > BigInt(0) ? remaining : BigInt(0), 18)}`);
                    return;
                }
            } catch (e) {
                toast.error('Invalid bet amount');
                return;
            }
        }

        const exists = placedBets.some(b => b.type === type && JSON.stringify([...b.numbers].sort()) === JSON.stringify([...numbers].sort()));
        if (exists) { toast.error('Bet already placed'); return; }
        const newBet: PlacedBet = { id: `${Date.now()}-${Math.random()}`, type, label, numbers, amount: currentBetAmount, payout: `${CASINO_PAYOUT_MULTIPLIERS[type]}:1` };
        setPlacedBets(prev => [...prev, newBet]);
        toast.success(`Added ${label} bet`);
    }, [canAddMoreBets, currentBetAmount, maxBets, placedBets, config, tokenSymbol, pendingGame]);

    const removeBet = useCallback((id: string) => { setPlacedBets(prev => prev.filter(b => b.id !== id)); }, []);
    const clearBets = useCallback(() => { setPlacedBets([]); }, []);

    const hasBet = useCallback((type: CasinoBetType, numbers: number[]) => {
        return placedBets.some(b => b.type === type && JSON.stringify([...b.numbers].sort()) === JSON.stringify([...numbers].sort()));
    }, [placedBets]);

    // Prepare bet data for CasinoTransaction
    const betTypes = useMemo(() => placedBets.map(b => b.type), [placedBets]);
    const betNumbersArray = useMemo(() => placedBets.map(b => b.numbers), [placedBets]);
    const betAmounts = useMemo(() => placedBets.map(b => parseUnits(b.amount, 18)), [placedBets]);

    // Handle place bets completion
    const handlePlaceBetsComplete = useCallback((result?: {}) => {
        if (result === undefined) {
            // Transaction failed
            setError('Failed to place bets');
            setIsSpinning(false);
            setSpinPhase('idle');
            setWheelSpinning(false);
            return;
        }
        // Bets placed successfully, transition to waiting/reveal phase
        setError(null); // Clear any previous errors
        setIsSpinning(false); // Stop the spinning state from placeBets
        setSpinPhase('waiting');
        setPendingGame(true);
        // After short delay, enable reveal
        setTimeout(() => {
            setSpinPhase('revealing');
        }, 5000);
    }, []);

    // Handle reveal completion
    const handleRevealComplete = useCallback((result?: { winningNumber?: number; won?: boolean; payout?: string }) => {
        // Only process if we're actually in a reveal phase
        // This prevents false errors from OnchainKit status callbacks on initial render
        if (spinPhase !== 'revealing' && !isSpinning) {
            return; // Ignore callbacks when not actively revealing
        }

        setIsSpinning(false);
        setSpinPhase('idle');

        if (result === undefined) {
            // Transaction failed - but only show error if we were actually trying
            setError('Reveal failed');
            setWheelSpinning(false);
            return;
        }

        if (result.winningNumber !== undefined) {
            setError(null); // Clear any errors on success
            setResult({
                number: result.winningNumber,
                won: result.won ?? false,
                payout: result.payout ?? '0'
            });
            setWheelWinningNumber(result.winningNumber);
            refetchBalance();
        } else {
            setError('Could not verify result');
            setWheelSpinning(false);
        }

        setPendingGame(false);
        setPlacedBets([]);
        onSpinComplete?.();
    }, [onSpinComplete, refetchBalance, spinPhase, isSpinning]);

    // Handle transaction status updates for UI feedback
    const handleStatusUpdate = useCallback((status: LifecycleStatus) => {
        if (status.statusName === 'transactionPending') {
            setError(null);
            setIsSpinning(true);
            setResult(null);
            setWheelWinningNumber(null);
            setWheelSpinning(true);
        }
    }, []);

    // Button click handler to start spinning immediately
    const handleSpinButtonClick = useCallback(() => {
        setSpinPhase('betting');
        setError(null);
        setResult(null);
        setWheelWinningNumber(null);
        setWheelSpinning(true);
    }, []);

    const refreshApproval = useCallback(async () => {
        if (address) {
            const approval = await checkCasinoApproval(address, config?.bettingToken || PIXOTCHI_TOKEN_ADDRESS);
            setAllowanceWei(approval);
        }
    }, [address, config]);

    const getNumberColor = (n: number): string => n === 0 ? 'bg-green-600' : RED_NUMBERS.includes(n) ? 'bg-red-600' : 'bg-gray-900';

    // Render a number cell with optional edge hitboxes
    const renderNumberCell = (num: number, rowIndex: 0 | 1 | 2, colIndex: number) => {
        const isRed = RED_NUMBERS.includes(num);
        const isTop = rowIndex === 0; // Row with 3,6,9...
        const isBottom = rowIndex === 2; // Row with 1,4,7...
        const isLastCol = colIndex === 11;

        // Calculate adjacent numbers for complex bets
        const numAbove = num + 1; // e.g., if num=2, above=3
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
                    onClick={() => addBet(CasinoBetType.STRAIGHT, `${num}`, [num])}
                    className={`w-full h-10 md:h-14 flex items-center justify-center rounded-sm text-[10px] md:text-sm font-bold text-white transition-all border border-white/10 
                        ${hasBet(CasinoBetType.STRAIGHT, [num]) ? 'ring-2 ring-amber-400 z-10' : 'hover:brightness-110'}
                        ${isRed ? 'bg-red-600' : 'bg-gray-900'}`}
                >
                    {num}
                </button>

                {/* Street bet hitbox - Top Edge Center */}
                {isTop && (
                    <div
                        className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 cursor-pointer z-20 flex items-center justify-center group"
                        onClick={(e) => { e.stopPropagation(); addBet(CasinoBetType.STREET, `Street ${streetNums[0]}-${streetNums[2]}`, streetNums); }}
                    >
                        <div className={`w-6 h-2 rounded-full transition-all shadow-sm ${hasBet(CasinoBetType.STREET, streetNums) ? 'bg-purple-500 ring-1 ring-white' : 'hover:bg-purple-400/70'}`} />
                    </div>
                )}

                {/* Horizontal split hitbox - Bottom Edge Center */}
                {!isBottom && (
                    <div
                        className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 w-8 h-6 cursor-pointer z-20 flex items-center justify-center group"
                        onClick={(e) => { e.stopPropagation(); addBet(CasinoBetType.SPLIT, `Split ${numBelow}-${num}`, [numBelow, num]); }}
                    >
                        <div className={`w-3 h-3 rounded-full transition-all shadow-sm ${hasBet(CasinoBetType.SPLIT, [numBelow, num]) ? 'bg-amber-400 ring-1 ring-white' : 'hover:bg-white/60'}`} />
                    </div>
                )}

                {/* Vertical split hitbox - Right Edge Center */}
                {!isLastCol && (
                    <div
                        className="absolute top-1/2 right-0 translate-x-1/2 -translate-y-1/2 w-6 h-8 cursor-pointer z-20 flex items-center justify-center group"
                        onClick={(e) => { e.stopPropagation(); addBet(CasinoBetType.SPLIT, `Split ${num}-${numRight}`, [num, numRight]); }}
                    >
                        <div className={`w-3 h-3 rounded-full transition-all shadow-sm ${hasBet(CasinoBetType.SPLIT, [num, numRight]) ? 'bg-amber-400 ring-1 ring-white' : 'hover:bg-white/60'}`} />
                    </div>
                )}

                {/* Corner hitbox - Bottom Right Corner */}
                {!isBottom && !isLastCol && (
                    <div
                        className="absolute bottom-0 right-0 translate-x-1/2 translate-y-1/2 w-6 h-6 cursor-pointer z-30 flex items-center justify-center group"
                        onClick={(e) => {
                            e.stopPropagation();
                            const cornerSet = [numBelow, num, numBelow + 3, numRight];
                            addBet(CasinoBetType.CORNER, `Corner ${cornerSet.join(',')}`, cornerSet);
                        }}
                    >
                        <div className={`w-3 h-3 rounded-full transition-all shadow-sm ${hasBet(CasinoBetType.CORNER, [numBelow, num, numBelow + 3, numRight]) ? 'bg-blue-400 ring-1 ring-white' : 'hover:bg-blue-400/70'}`} />
                    </div>
                )}

                {/* Six-line hitbox - Top Right Corner */}
                {isTop && !isLastCol && (
                    <div
                        className="absolute top-0 right-0 translate-x-1/2 -translate-y-1/2 w-6 h-6 cursor-pointer z-30 flex items-center justify-center group"
                        onClick={(e) => { e.stopPropagation(); addBet(CasinoBetType.SIX_LINE, `6-Line ${streetNums[0]}-${streetNums[2] + 3}`, sixLineNums); }}
                    >
                        <div className={`w-3 h-3 rounded-full transition-all shadow-sm ${hasBet(CasinoBetType.SIX_LINE, sixLineNums) ? 'bg-orange-400 ring-1 ring-white' : 'hover:bg-orange-400/70'}`} />
                    </div>
                )}
            </div>
        );
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="max-w-4xl max-h-[90vh] overflow-y-auto p-3 md:p-6 w-[95vw] md:w-full rounded-xl bg-cover bg-center bg-no-repeat bg-[url('/icons/casino.png')]"
            >
                <DialogHeader>
                    <DialogTitle className="font-pixel text-xl flex items-center gap-2 text-white">
                        Roulette
                        <span className="text-xs font-normal text-white/80 ml-2">(Beta)</span>
                        <SponsoredBadge show={isSponsored} className="ml-auto" />
                    </DialogTitle>
                </DialogHeader>

                <div className="space-y-4 relative mt-4">
                    {/* Wheel + Bets Panel Side by Side */}
                    <div className="flex flex-col md:flex-row gap-6 items-center">
                        {/* European Roulette Wheel - Left Side */}
                        <div className="flex flex-col items-center gap-2 shrink-0">
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
                            {isSpinning && (
                                <div className="text-center text-sm text-white/90">
                                    <Loader2 className="inline h-4 w-4 animate-spin mr-2" />
                                    {spinPhase === 'betting' && 'Placing bets...'}{spinPhase === 'waiting' && 'Waiting for block...'}{spinPhase === 'revealing' && 'Revealing...'}
                                </div>
                            )}
                        </div>

                        {/* Bets Panel - Right Side */}
                        <div className="flex-1 w-full md:w-auto">
                            <div className="bg-black/40 backdrop-blur-sm rounded-lg p-3 border border-white/10 h-full text-white">
                                <div className="flex justify-between items-center mb-2">
                                    <span className="text-sm font-semibold">Your Bets ({placedBets.length}/{maxBets})</span>
                                    {placedBets.length > 0 && <Button variant="ghost" size="sm" onClick={clearBets} className="h-6 text-xs px-2"><Trash2 className="h-3 w-3 mr-1" />Clear</Button>}
                                </div>
                                {placedBets.length === 0 ? (
                                    <p className="text-xs text-white/60 text-center py-4">Click on table below to add bets</p>
                                ) : (
                                    <div className="flex flex-wrap gap-1">
                                        {placedBets.map(bet => (
                                            <div key={bet.id} className="inline-flex items-center gap-1 bg-black/60 rounded pl-1.5 pr-1 py-0.5 text-[10px] border border-white/20 shrink-0">
                                                <span className="font-medium whitespace-nowrap text-white">{bet.label}</span>
                                                <span className="text-white/70 opacity-80">({bet.amount})</span>
                                                <button onClick={() => removeBet(bet.id)} className="!w-3 !h-3 !min-w-0 !min-h-0 !p-0 text-red-500 hover:text-red-600 transition-colors opacity-70 hover:opacity-100 flex items-center justify-center shrink-0">
                                                    <X className="!h-3 !w-3" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                {placedBets.length > 0 && (
                                    <div className="flex justify-between mt-2 pt-2 border-t border-border text-xs">
                                        <span>Total: <strong>{totalBetAmount.toFixed(2)} {tokenSymbol}</strong></span>
                                        <span className="text-green-500">Max Win: <strong>{bestPossibleWin.toFixed(2)} {tokenSymbol}</strong></span>
                                    </div>
                                )}
                            </div>

                            {/* Result Banner */}
                            {result && !isSpinning && (
                                <div className={`mt-3 text-center p-2 rounded-lg text-sm border font-medium ${result.won ? 'bg-green-600/90 text-white border-green-400' : 'bg-black/60 text-white/90 border-white/20'}`}>
                                    <span className="font-bold">{result.won ? `🎉 Won ${parseFloat(result.payout).toFixed(2)} ${tokenSymbol}!` : 'No win'}</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Bet Amount */}
                    <div className="flex items-center gap-2">
                        <label className="text-xs text-white font-medium">Bet:</label>
                        <Input
                            type="number"
                            value={currentBetAmount}
                            onChange={(e) => setCurrentBetAmount(e.target.value)}
                            className="w-16 h-7 text-xs bg-black/40 border-white/20 text-white placeholder:text-white/50"
                            min="1"
                        />
                        <span className="text-xs text-white/90 font-bold">{tokenSymbol}</span>
                        {balanceData && <span className={`text-xs ml-auto font-medium ${isInsufficientBalance ? 'text-red-400' : 'text-white/80'}`}>Bal: {formatTokenAmount(balanceData.value, balanceData.decimals)}</span>}
                    </div>

                    {/* BETTING TABLE - Fully Responsive Fit */}
                    <div className="select-none w-full overflow-x-auto pb-4">
                        <div className="min-w-[320px] md:min-w-0 mx-auto max-w-[800px]">
                            {/* Numbers Grid */}
                            <div className="grid grid-cols-[30px_repeat(12,1fr)_30px] md:grid-cols-[48px_repeat(12,1fr)_48px] gap-[1px] md:gap-[2px] w-full bg-border p-[1px] rounded-lg">
                                {/* Zero - Spans 3 rows */}
                                <div className="row-span-3 h-full relative">
                                    <button
                                        onClick={() => addBet(CasinoBetType.STRAIGHT, '0', [0])}
                                        className={`w-full h-full flex items-center justify-center rounded-l-md text-xs md:text-sm font-bold text-white bg-green-600 border border-white/10
                                            ${hasBet(CasinoBetType.STRAIGHT, [0]) ? 'ring-2 inset-2 ring-amber-400 z-10' : 'hover:brightness-110'}`}
                                    ><span className="-rotate-90">0</span></button>

                                    {/* Trio 0-2-3 (Top intersection) */}
                                    <button
                                        onClick={(e) => { e.stopPropagation(); addBet(CasinoBetType.STREET, 'Trio 0-2-3', [0, 2, 3]); }}
                                        className="absolute top-[33.33%] right-0 translate-x-1/2 -translate-y-1/2 w-6 h-6 z-20 flex items-center justify-center group"
                                        title="Bet on 0, 2, 3"
                                    >
                                        <div className={`w-3 h-3 rounded-full transition-all shadow-sm ${hasBet(CasinoBetType.STREET, [0, 2, 3]) ? 'bg-teal-400 ring-1 ring-white' : 'hover:bg-teal-400/70 bg-transparent'}`} />
                                    </button>

                                    {/* Trio 0-1-2 (Bottom intersection) */}
                                    <button
                                        onClick={(e) => { e.stopPropagation(); addBet(CasinoBetType.STREET, 'Trio 0-1-2', [0, 1, 2]); }}
                                        className="absolute top-[66.66%] right-0 translate-x-1/2 -translate-y-1/2 w-6 h-6 z-20 flex items-center justify-center group"
                                        title="Bet on 0, 1, 2"
                                    >
                                        <div className={`w-3 h-3 rounded-full transition-all shadow-sm ${hasBet(CasinoBetType.STREET, [0, 1, 2]) ? 'bg-teal-400 ring-1 ring-white' : 'hover:bg-teal-400/70 bg-transparent'}`} />
                                    </button>
                                </div>

                                {/* Row 3 (Top): 3, 6, 9... 36 */}
                                {[...Array(12)].map((_, i) => renderNumberCell((i * 3) + 3, 0, i))}

                                {/* 2to1 Column 3 */}
                                <button onClick={() => addBet(CasinoBetType.COLUMN, '3rd Col', [3])}
                                    className={`w-full h-full flex items-center justify-center rounded-r-sm text-[8px] md:text-[10px] font-bold border border-white/20 bg-black/40 text-white
                                        ${hasBet(CasinoBetType.COLUMN, [3]) ? 'ring-2 inset-1 ring-primary bg-primary/40' : 'hover:bg-black/60'}`}>
                                    <span className="-rotate-90">2:1</span>
                                </button>

                                {/* Row 2 (Mid): 2, 5, 8... 35 */}
                                {[...Array(12)].map((_, i) => renderNumberCell((i * 3) + 2, 1, i))}

                                {/* 2to1 Column 2 */}
                                <button onClick={() => addBet(CasinoBetType.COLUMN, '2nd Col', [2])}
                                    className={`w-full h-full flex items-center justify-center rounded-r-sm text-[8px] md:text-[10px] font-bold border border-white/20 bg-black/40 text-white
                                        ${hasBet(CasinoBetType.COLUMN, [2]) ? 'ring-2 inset-1 ring-primary bg-primary/40' : 'hover:bg-black/60'}`}>
                                    <span className="-rotate-90">2:1</span>
                                </button>

                                {/* Row 1 (Bottom): 1, 4, 7... 34 */}
                                {[...Array(12)].map((_, i) => renderNumberCell((i * 3) + 1, 2, i))}

                                {/* 2to1 Column 1 */}
                                <button onClick={() => addBet(CasinoBetType.COLUMN, '1st Col', [1])}
                                    className={`w-full h-full flex items-center justify-center rounded-r-sm text-[8px] md:text-[10px] font-bold border border-white/20 bg-black/40 text-white
                                        ${hasBet(CasinoBetType.COLUMN, [1]) ? 'ring-2 inset-1 ring-primary bg-primary/40' : 'hover:bg-black/60'}`}>
                                    <span className="-rotate-90">2:1</span>
                                </button>
                            </div>

                            {/* Dozens */}
                            <div className="grid grid-cols-[30px_repeat(3,1fr)_30px] md:grid-cols-[48px_repeat(3,1fr)_48px] gap-[1px] md:gap-[2px] mt-[1px] md:mt-[2px] w-full">
                                <div />
                                <button onClick={() => addBet(CasinoBetType.DOZEN, '1st 12', [1])} className={`h-8 md:h-10 flex items-center justify-center rounded-sm text-[9px] md:text-xs font-bold border border-white/20 bg-black/40 text-white ${hasBet(CasinoBetType.DOZEN, [1]) ? 'ring-2 inset-1 ring-primary bg-primary/40' : 'hover:bg-black/60'}`}>1st 12</button>
                                <button onClick={() => addBet(CasinoBetType.DOZEN, '2nd 12', [2])} className={`h-8 md:h-10 flex items-center justify-center rounded-sm text-[9px] md:text-xs font-bold border border-white/20 bg-black/40 text-white ${hasBet(CasinoBetType.DOZEN, [2]) ? 'ring-2 inset-1 ring-primary bg-primary/40' : 'hover:bg-black/60'}`}>2nd 12</button>
                                <button onClick={() => addBet(CasinoBetType.DOZEN, '3rd 12', [3])} className={`h-8 md:h-10 flex items-center justify-center rounded-sm text-[9px] md:text-xs font-bold border border-white/20 bg-black/40 text-white ${hasBet(CasinoBetType.DOZEN, [3]) ? 'ring-2 inset-1 ring-primary bg-primary/40' : 'hover:bg-black/60'}`}>3rd 12</button>
                                <div />
                            </div>

                            {/* Outside Bets */}
                            <div className="grid grid-cols-[30px_repeat(6,1fr)_30px] md:grid-cols-[48px_repeat(6,1fr)_48px] gap-[1px] md:gap-[2px] mt-[1px] md:mt-[2px] w-full">
                                <div />
                                <button onClick={() => addBet(CasinoBetType.LOW, '1-18', [])} className={`h-8 md:h-10 flex items-center justify-center rounded-sm text-[8px] md:text-xs font-bold border border-white/20 bg-black/40 text-white ${hasBet(CasinoBetType.LOW, []) ? 'ring-2 inset-1 ring-primary bg-primary/40' : 'hover:bg-black/60'}`}>1-18</button>
                                <button onClick={() => addBet(CasinoBetType.EVEN, 'EVEN', [])} className={`h-8 md:h-10 flex items-center justify-center rounded-sm text-[8px] md:text-xs font-bold border border-white/20 bg-black/40 text-white ${hasBet(CasinoBetType.EVEN, []) ? 'ring-2 inset-1 ring-primary bg-primary/40' : 'hover:bg-black/60'}`}>EVEN</button>
                                <button onClick={() => addBet(CasinoBetType.RED, 'RED', [])} className={`h-8 md:h-10 flex items-center justify-center rounded-sm text-[8px] md:text-xs font-bold text-white bg-red-600 border border-white/10 ${hasBet(CasinoBetType.RED, []) ? 'ring-2 inset-1 ring-amber-400' : 'hover:brightness-110'}`}>RED</button>
                                <button onClick={() => addBet(CasinoBetType.BLACK, 'BLACK', [])} className={`h-8 md:h-10 flex items-center justify-center rounded-sm text-[8px] md:text-xs font-bold text-white bg-gray-900 border border-white/10 ${hasBet(CasinoBetType.BLACK, []) ? 'ring-2 inset-1 ring-amber-400' : 'hover:brightness-110'}`}>BLACK</button>
                                <button onClick={() => addBet(CasinoBetType.ODD, 'ODD', [])} className={`h-8 md:h-10 flex items-center justify-center rounded-sm text-[8px] md:text-xs font-bold border border-white/20 bg-black/40 text-white ${hasBet(CasinoBetType.ODD, []) ? 'ring-2 inset-1 ring-primary bg-primary/40' : 'hover:bg-black/60'}`}>ODD</button>
                                <button onClick={() => addBet(CasinoBetType.HIGH, '19-36', [])} className={`h-8 md:h-10 flex items-center justify-center rounded-sm text-[8px] md:text-xs font-bold border border-white/20 bg-black/40 text-white ${hasBet(CasinoBetType.HIGH, []) ? 'ring-2 inset-1 ring-primary bg-primary/40' : 'hover:bg-black/60'}`}>19-36</button>
                                <div />
                            </div>
                        </div>
                    </div>

                    {/* Bet Legend */}
                    <div className="flex flex-wrap gap-2 text-[9px] text-white/80 justify-center font-medium bg-black/20 p-1 rounded-full">
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-400" />Street</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-teal-400" />Trio</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-white/60" />Split</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400" />Corner</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-400" />6-Line</span>
                    </div>

                    {/* Action */}
                    <div className="space-y-2">
                        {!pendingGame && config && !config.enabled ? (
                            <Button className="w-full" disabled variant="secondary">
                                Roulette disabled
                            </Button>
                        ) : !hasApproval ? (
                            <ApproveTransaction spenderAddress={LAND_CONTRACT_ADDRESS} tokenAddress={(config?.bettingToken || PIXOTCHI_TOKEN_ADDRESS) as `0x${string}`} onSuccess={refreshApproval} buttonText={`Approve ${tokenSymbol}`} buttonClassName="w-full" />
                        ) : isInsufficientBalance && !pendingGame ? (
                            <Button className="w-full" disabled variant="destructive">
                                Insufficient Balance
                            </Button>
                        ) : pendingGame || spinPhase === 'waiting' || spinPhase === 'revealing' ? (
                            <CasinoTransaction
                                mode="reveal"
                                landId={landId}
                                buttonText={isSpinning ? (spinPhase === 'waiting' ? 'Waiting...' : 'Revealing...') : 'Resume (Reveal)'}
                                buttonClassName="w-full"
                                disabled={isSpinning && spinPhase === 'waiting'}
                                onStatusUpdate={handleStatusUpdate}
                                onComplete={handleRevealComplete}
                                tokenSymbol={tokenSymbol}
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
                                buttonText={isSpinning ? 'Placing...' : `🎲 Spin (${totalBetAmount.toFixed(2)} ${tokenSymbol})`}
                                buttonClassName="w-full"
                                disabled={isSpinning}
                                onStatusUpdate={handleStatusUpdate}
                                onComplete={handlePlaceBetsComplete}
                                onButtonClick={handleSpinButtonClick}
                                tokenSymbol={tokenSymbol}
                            />
                        )}
                        {error && <p className="text-xs text-destructive text-center">{error}</p>}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
