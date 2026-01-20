"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, X, Trash2 } from 'lucide-react';
import { parseUnits, formatUnits, decodeEventLog } from 'viem';
import { useWalletClient, usePublicClient, useAccount, useBalance } from 'wagmi';
import {
    casinoPlaceBets,
    casinoReveal,
    casinoGetActiveBet,
    casinoGetConfig,
    checkCasinoApproval,
    LAND_CONTRACT_ADDRESS,
    PIXOTCHI_TOKEN_ADDRESS,
} from '@/lib/contracts';
import { casinoAbi, CasinoBetType, CASINO_PAYOUT_MULTIPLIERS, RED_NUMBERS } from '@/public/abi/casino-abi';
import ApproveTransaction from './approve-transaction';
import { toast } from 'react-hot-toast';

interface CasinoDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    landId: bigint;
    onSpinComplete?: () => void;
}

// Individual bet entry for multi-bet
interface PlacedBet {
    id: string;
    type: CasinoBetType;
    label: string;
    numbers: number[];
    amount: string;
    payout: string;
}

// Roulette wheel numbers in order (European)
const WHEEL_NUMBERS = [
    0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
    5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26
];

export default function CasinoDialog({ open, onOpenChange, landId, onSpinComplete }: CasinoDialogProps) {
    const { data: walletClient } = useWalletClient();
    const publicClient = usePublicClient();
    const { address } = useAccount();

    // Multi-bet state
    const [placedBets, setPlacedBets] = useState<PlacedBet[]>([]);
    const [currentBetAmount, setCurrentBetAmount] = useState('10');

    // Game state
    const [isSpinning, setIsSpinning] = useState(false);
    const [spinPhase, setSpinPhase] = useState<'idle' | 'betting' | 'waiting' | 'revealing'>('idle');
    const [result, setResult] = useState<{ number: number; won: boolean; payout: string } | null>(null);
    const [wheelRotation, setWheelRotation] = useState(0);

    // Config & approval
    const [config, setConfig] = useState<{ minBet: bigint; maxBet: bigint; bettingToken: string; maxBetsPerGame: number } | null>(null);
    const [hasApproval, setHasApproval] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [pendingGame, setPendingGame] = useState<boolean>(false);

    // Get token balance
    const { data: balanceData } = useBalance({
        address: address,
        token: config?.bettingToken as `0x${string}` || PIXOTCHI_TOKEN_ADDRESS,
        query: { enabled: !!address }
    });

    // Calculate totals
    const totalBetAmount = useMemo(() => {
        return placedBets.reduce((sum, bet) => sum + parseFloat(bet.amount || '0'), 0);
    }, [placedBets]);

    const totalPotentialWin = useMemo(() => {
        return placedBets.reduce((sum, bet) => {
            const amount = parseFloat(bet.amount || '0');
            const multiplier = CASINO_PAYOUT_MULTIPLIERS[bet.type] + 1;
            return sum + (amount * multiplier);
        }, 0);
    }, [placedBets]);

    const balanceVal = balanceData ? parseFloat(formatUnits(balanceData.value, balanceData.decimals)) : 0;
    const isInsufficientBalance = totalBetAmount > balanceVal;
    const maxBets = config?.maxBetsPerGame || 2;
    const canAddMoreBets = placedBets.length < maxBets;

    // Load config and check for pending games
    useEffect(() => {
        const loadConfig = async () => {
            try {
                const cfg = await casinoGetConfig();
                const bettingToken = cfg?.bettingToken || PIXOTCHI_TOKEN_ADDRESS;

                if (cfg) {
                    setConfig({
                        minBet: cfg.minBet,
                        maxBet: cfg.maxBet,
                        bettingToken: bettingToken,
                        maxBetsPerGame: Number(cfg.maxBetsPerGame) || 2
                    });
                }

                // Check for active game
                if (landId) {
                    try {
                        const activeGame = await casinoGetActiveBet(landId);
                        if (activeGame && activeGame.isActive) {
                            setPendingGame(true);
                            setSpinPhase('revealing');
                        }
                    } catch (e) {
                        console.error('Failed to check active game:', e);
                    }
                }

                // Check approval
                if (address) {
                    const approval = await checkCasinoApproval(address, bettingToken);
                    setHasApproval(approval > BigInt(0));
                }
            } catch (e) {
                console.error('Failed to load casino config:', e);
            }
        };
        if (open) loadConfig();
    }, [open, address, landId]);

    // Wheel animation during spin
    useEffect(() => {
        if (!isSpinning) return;
        const interval = setInterval(() => {
            setWheelRotation(prev => (prev + 15) % 360);
        }, 50);
        return () => clearInterval(interval);
    }, [isSpinning]);

    // Add a bet to the list
    const addBet = useCallback((type: CasinoBetType, label: string, numbers: number[]) => {
        if (!canAddMoreBets) {
            toast.error(`Maximum ${maxBets} bets per spin`);
            return;
        }

        // Check if this exact bet already exists
        const exists = placedBets.some(b =>
            b.type === type &&
            JSON.stringify([...b.numbers].sort()) === JSON.stringify([...numbers].sort())
        );
        if (exists) {
            toast.error('Bet already placed');
            return;
        }

        const newBet: PlacedBet = {
            id: `${Date.now()}-${Math.random()}`,
            type,
            label,
            numbers,
            amount: currentBetAmount,
            payout: `${CASINO_PAYOUT_MULTIPLIERS[type]}:1`
        };

        setPlacedBets(prev => [...prev, newBet]);
        toast.success(`Added ${label} bet`);
    }, [canAddMoreBets, currentBetAmount, maxBets, placedBets]);

    // Remove a bet
    const removeBet = useCallback((id: string) => {
        setPlacedBets(prev => prev.filter(b => b.id !== id));
    }, []);

    // Clear all bets
    const clearBets = useCallback(() => {
        setPlacedBets([]);
    }, []);

    // Check if a bet is already placed
    const hasBet = useCallback((type: CasinoBetType, numbers: number[]) => {
        return placedBets.some(b =>
            b.type === type &&
            JSON.stringify([...b.numbers].sort()) === JSON.stringify([...numbers].sort())
        );
    }, [placedBets]);

    // Handle reveal
    const handleReveal = useCallback(async () => {
        if (!walletClient || !publicClient) return;

        try {
            setSpinPhase('revealing');
            const hash = await casinoReveal(walletClient, landId);
            const receipt = await publicClient.waitForTransactionReceipt({ hash: hash as `0x${string}` });

            let spinResult = null;
            for (const log of receipt.logs) {
                try {
                    const decoded = decodeEventLog({
                        abi: casinoAbi,
                        data: log.data,
                        topics: log.topics,
                    });
                    if (decoded.eventName === 'RouletteSpinResult') {
                        spinResult = decoded.args;
                        break;
                    }
                } catch { continue; }
            }

            if (spinResult) {
                const { winningNumber, won, payout } = spinResult as any;
                setResult({
                    number: Number(winningNumber),
                    won: won,
                    payout: formatUnits(payout, 18)
                });

                const numberIndex = WHEEL_NUMBERS.indexOf(Number(winningNumber));
                const finalRotation = (numberIndex / WHEEL_NUMBERS.length) * 360;
                setWheelRotation(finalRotation);

                if (won) {
                    toast.success(`🎉 You won ${formatUnits(payout, 18)} SEED!`);
                } else {
                    toast('Better luck next time!', { icon: '🎲' });
                }
            } else {
                setError('Could not verify result (or bet expired)');
            }

            setPendingGame(false);
            setPlacedBets([]);
            onSpinComplete?.();
        } catch (err: any) {
            console.error('Reveal failed:', err);
            setError(err.message || 'Reveal failed');
            toast.error('Reveal failed');
        } finally {
            setIsSpinning(false);
            setSpinPhase('idle');
        }
    }, [walletClient, publicClient, landId, onSpinComplete]);

    // Handle spin (place all bets)
    const handleSpin = useCallback(async () => {
        if (!walletClient || !publicClient || placedBets.length === 0) return;

        setError(null);
        setIsSpinning(true);
        setResult(null);
        setSpinPhase('betting');

        try {
            const betTypes = placedBets.map(b => b.type);
            const betNumbersArray = placedBets.map(b => b.numbers);
            const betAmounts = placedBets.map(b => parseUnits(b.amount, 18));

            await casinoPlaceBets(walletClient, landId, betTypes, betNumbersArray, betAmounts);
            toast.success('Bets placed! Waiting for block...');

            setSpinPhase('waiting');
            await new Promise(resolve => setTimeout(resolve, 5000));
            await handleReveal();

        } catch (err: any) {
            console.error('Spin failed:', err);
            setError(err.message || 'Spin failed');
            toast.error('Spin failed');
            setIsSpinning(false);
            setSpinPhase('idle');
        }
    }, [walletClient, publicClient, placedBets, landId, handleReveal]);

    // Refresh approval
    const refreshApproval = useCallback(async () => {
        if (address) {
            const token = config?.bettingToken || PIXOTCHI_TOKEN_ADDRESS;
            const approval = await checkCasinoApproval(address, token);
            setHasApproval(approval > BigInt(0));
        }
    }, [address, config]);

    const getNumberColor = (n: number): string => {
        if (n === 0) return 'bg-green-600';
        return RED_NUMBERS.includes(n) ? 'bg-red-600' : 'bg-gray-900';
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="font-pixel text-xl flex items-center gap-2">
                        🎰 European Roulette
                        <span className="text-xs font-normal text-muted-foreground ml-2">
                            (Max {maxBets} bets)
                        </span>
                    </DialogTitle>
                </DialogHeader>

                <div className="space-y-4 relative">
                    {/* Roulette Wheel */}
                    <div className="flex justify-center">
                        <div className="relative w-48 h-48">
                            <div
                                className="w-full h-full rounded-full border-4 border-amber-600 shadow-lg overflow-hidden"
                                style={{
                                    transform: `rotate(${wheelRotation}deg)`,
                                    transition: isSpinning ? 'none' : 'transform 0.5s ease-out',
                                    background: 'conic-gradient(from 0deg, #dc2626 0deg 9.73deg, #1f2937 9.73deg 19.46deg, #dc2626 19.46deg 29.19deg, #1f2937 29.19deg 38.92deg, #dc2626 38.92deg 48.65deg, #1f2937 48.65deg 58.38deg, #16a34a 58.38deg 68.11deg, #dc2626 68.11deg 77.84deg, #1f2937 77.84deg 87.57deg, #dc2626 87.57deg 97.3deg, #1f2937 97.3deg 107.03deg, #dc2626 107.03deg 116.76deg, #1f2937 116.76deg 126.49deg, #dc2626 126.49deg 136.22deg, #1f2937 136.22deg 145.95deg, #dc2626 145.95deg 155.68deg, #1f2937 155.68deg 165.41deg, #dc2626 165.41deg 175.14deg, #1f2937 175.14deg 184.87deg, #dc2626 184.87deg 194.6deg, #1f2937 194.6deg 204.33deg, #dc2626 204.33deg 214.06deg, #1f2937 214.06deg 223.79deg, #dc2626 223.79deg 233.52deg, #1f2937 233.52deg 243.25deg, #dc2626 243.25deg 252.98deg, #1f2937 252.98deg 262.71deg, #dc2626 262.71deg 272.44deg, #1f2937 272.44deg 282.17deg, #dc2626 282.17deg 291.9deg, #1f2937 291.9deg 301.63deg, #dc2626 301.63deg 311.36deg, #1f2937 311.36deg 321.09deg, #dc2626 321.09deg 330.82deg, #1f2937 330.82deg 340.55deg, #dc2626 340.55deg 350.28deg, #1f2937 350.28deg 360deg)'
                                }}
                            >
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <div className="w-16 h-16 rounded-full bg-amber-700 border-2 border-amber-500 flex items-center justify-center">
                                        <span className="text-white font-bold text-xs">SPIN</span>
                                    </div>
                                </div>
                            </div>
                            <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1">
                                <div className="w-3 h-3 bg-white rounded-full border border-gray-400 shadow-md" />
                            </div>
                            {result && (
                                <div className="absolute -bottom-8 left-1/2 -translate-x-1/2">
                                    <div className={`px-4 py-1 rounded-full text-white font-bold ${getNumberColor(result.number)}`}>
                                        {result.number}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Spin Status */}
                    {isSpinning && (
                        <div className="text-center text-sm text-muted-foreground">
                            <Loader2 className="inline h-4 w-4 animate-spin mr-2" />
                            {spinPhase === 'betting' && 'Placing bets...'}
                            {spinPhase === 'waiting' && 'Waiting for block...'}
                            {spinPhase === 'revealing' && 'Revealing result...'}
                        </div>
                    )}

                    {/* Result */}
                    {result && !isSpinning && (
                        <div className={`text-center p-3 rounded-lg ${result.won ? 'bg-primary/10 text-primary border border-primary/20' : 'bg-muted text-muted-foreground border border-border'}`}>
                            <div className="font-bold">
                                {result.won ? `🎉 Won ${parseFloat(result.payout).toFixed(2)} SEED!` : 'No win this time'}
                            </div>
                            <div className="text-sm">Winning number: {result.number}</div>
                        </div>
                    )}

                    {/* Selected Bets Panel */}
                    <div className="bg-muted/30 rounded-lg p-3 border border-border">
                        <div className="flex justify-between items-center mb-2">
                            <h3 className="text-sm font-semibold">Your Bets ({placedBets.length}/{maxBets})</h3>
                            {placedBets.length > 0 && (
                                <Button variant="ghost" size="sm" onClick={clearBets} className="h-6 text-xs">
                                    <Trash2 className="h-3 w-3 mr-1" /> Clear
                                </Button>
                            )}
                        </div>

                        {placedBets.length === 0 ? (
                            <p className="text-xs text-muted-foreground text-center py-2">
                                Click on the table below to add bets
                            </p>
                        ) : (
                            <div className="flex flex-wrap gap-2">
                                {placedBets.map(bet => (
                                    <div key={bet.id} className="flex items-center gap-1 bg-background rounded px-2 py-1 text-xs border border-border">
                                        <span className="font-medium">{bet.label}</span>
                                        <span className="text-muted-foreground">({bet.amount})</span>
                                        <button onClick={() => removeBet(bet.id)} className="ml-1 hover:text-destructive">
                                            <X className="h-3 w-3" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}

                        {placedBets.length > 0 && (
                            <div className="flex justify-between mt-2 pt-2 border-t border-border text-sm">
                                <span>Total: <strong>{totalBetAmount.toFixed(2)} SEED</strong></span>
                                <span className="text-green-500">Max Win: <strong>{totalPotentialWin.toFixed(2)} SEED</strong></span>
                            </div>
                        )}
                    </div>

                    {/* Bet Amount + Balance */}
                    <div className="flex items-center gap-2">
                        <label className="text-xs text-muted-foreground">Bet per:</label>
                        <Input
                            type="number"
                            value={currentBetAmount}
                            onChange={(e) => setCurrentBetAmount(e.target.value)}
                            className="w-20 h-8 text-sm"
                            min="1"
                        />
                        <span className="text-xs text-muted-foreground">SEED</span>
                        {balanceData && (
                            <span className={`text-xs ml-auto ${isInsufficientBalance ? 'text-red-400' : 'text-muted-foreground'}`}>
                                Balance: {parseFloat(formatUnits(balanceData.value, balanceData.decimals)).toFixed(2)}
                            </span>
                        )}
                    </div>

                    {/* ===== BETTING TABLE - ORIGINAL DESIGN WITH OVERLAYS ===== */}
                    <div className="flex flex-col gap-1 select-none w-full relative">
                        {/* THE GRID */}
                        <div className="grid grid-cols-[30px_repeat(12,1fr)_30px] md:grid-cols-[40px_repeat(12,1fr)_40px] gap-0.5 md:gap-1 relative z-10">

                            {/* Zero - Spans 3 rows */}
                            <button
                                onClick={() => addBet(CasinoBetType.STRAIGHT, '0', [0])}
                                className={`row-span-3 flex items-center justify-center rounded text-[10px] md:text-sm font-bold text-white transition-all border border-white/10 
                                    ${hasBet(CasinoBetType.STRAIGHT, [0]) ? 'ring-2 ring-amber-400 scale-105 z-20' : 'hover:brightness-110'} bg-green-600 min-w-0`}
                            >
                                <span className="-rotate-90">0</span>
                            </button>

                            {/* Row 3 (Top): 3, 6, 9... 36 + 2to1 */}
                            {[...Array(12)].map((_, i) => {
                                const num = (i * 3) + 3;
                                const isRed = RED_NUMBERS.includes(num);
                                return (
                                    <button
                                        key={num}
                                        onClick={() => addBet(CasinoBetType.STRAIGHT, `${num}`, [num])}
                                        className={`h-10 md:h-14 flex items-center justify-center rounded text-[10px] md:text-sm font-bold text-white transition-all border border-white/10 
                                            ${hasBet(CasinoBetType.STRAIGHT, [num]) ? 'ring-2 ring-amber-400 scale-105 z-20' : 'hover:brightness-110'}
                                            ${isRed ? 'bg-red-600' : 'bg-gray-900'} min-w-0 relative`}
                                    >
                                        {num}
                                    </button>
                                );
                            })}

                            {/* 2to1 (Column 3) */}
                            <button
                                onClick={() => addBet(CasinoBetType.COLUMN, '3rd Col', [3])}
                                className={`h-10 md:h-14 flex items-center justify-center rounded text-[8px] md:text-xs font-bold text-foreground transition-all border border-border 
                                    ${hasBet(CasinoBetType.COLUMN, [3]) ? 'ring-2 ring-primary bg-primary/20' : 'bg-transparent hover:bg-muted'} min-w-0`}
                            >
                                <span className="-rotate-90 whitespace-nowrap">2to1</span>
                            </button>

                            {/* Row 2 (Middle): 2, 5, 8... 35 + 2to1 */}
                            {[...Array(12)].map((_, i) => {
                                const num = (i * 3) + 2;
                                const isRed = RED_NUMBERS.includes(num);
                                return (
                                    <button
                                        key={num}
                                        onClick={() => addBet(CasinoBetType.STRAIGHT, `${num}`, [num])}
                                        className={`h-10 md:h-14 flex items-center justify-center rounded text-[10px] md:text-sm font-bold text-white transition-all border border-white/10 
                                            ${hasBet(CasinoBetType.STRAIGHT, [num]) ? 'ring-2 ring-amber-400 scale-105 z-20' : 'hover:brightness-110'}
                                            ${isRed ? 'bg-red-600' : 'bg-gray-900'} min-w-0 relative`}
                                    >
                                        {num}
                                    </button>
                                );
                            })}

                            {/* 2to1 (Column 2) */}
                            <button
                                onClick={() => addBet(CasinoBetType.COLUMN, '2nd Col', [2])}
                                className={`h-10 md:h-14 flex items-center justify-center rounded text-[8px] md:text-xs font-bold text-foreground transition-all border border-border 
                                    ${hasBet(CasinoBetType.COLUMN, [2]) ? 'ring-2 ring-primary bg-primary/20' : 'bg-transparent hover:bg-muted'} min-w-0`}
                            >
                                <span className="-rotate-90 whitespace-nowrap">2to1</span>
                            </button>

                            {/* Row 1 (Bottom): 1, 4, 7... 34 + 2to1 */}
                            {[...Array(12)].map((_, i) => {
                                const num = (i * 3) + 1;
                                const isRed = RED_NUMBERS.includes(num);
                                return (
                                    <button
                                        key={num}
                                        onClick={() => addBet(CasinoBetType.STRAIGHT, `${num}`, [num])}
                                        className={`h-10 md:h-14 flex items-center justify-center rounded text-[10px] md:text-sm font-bold text-white transition-all border border-white/10 
                                            ${hasBet(CasinoBetType.STRAIGHT, [num]) ? 'ring-2 ring-amber-400 scale-105 z-20' : 'hover:brightness-110'}
                                            ${isRed ? 'bg-red-600' : 'bg-gray-900'} min-w-0 relative`}
                                    >
                                        {num}
                                    </button>
                                );
                            })}

                            {/* 2to1 (Column 1) */}
                            <button
                                onClick={() => addBet(CasinoBetType.COLUMN, '1st Col', [1])}
                                className={`h-10 md:h-14 flex items-center justify-center rounded text-[8px] md:text-xs font-bold text-foreground transition-all border border-border 
                                    ${hasBet(CasinoBetType.COLUMN, [1]) ? 'ring-2 ring-primary bg-primary/20' : 'bg-transparent hover:bg-muted'} min-w-0`}
                            >
                                <span className="-rotate-90 whitespace-nowrap">2to1</span>
                            </button>

                            {/* --- OVERLAYS FOR COMPLEX BETS --- */}

                            {/* Horizontal Splits (Between Rows) */}
                            {[...Array(12)].map((_, i) => {
                                const topNum = (i * 3) + 3;
                                const bottomNum = (i * 3) + 2;
                                const isSelected = hasBet(CasinoBetType.SPLIT, [bottomNum, topNum]);
                                return (
                                    <div key={`split-h-${i}`} className="absolute z-30 w-full h-4 -bottom-2 cursor-pointer group"
                                        style={{ gridColumnStart: i + 2, gridRowStart: 1, top: 'calc(100% - 8px)' }}
                                        onClick={() => addBet(CasinoBetType.SPLIT, `Split ${bottomNum}-${topNum}`, [bottomNum, topNum])}
                                    >
                                        <div className={`w-4 h-4 mx-auto rounded-full transition-colors ${isSelected ? 'bg-amber-400 ring-2 ring-white' : 'group-hover:bg-white/50'}`} />
                                    </div>
                                );
                            })}

                            {[...Array(12)].map((_, i) => {
                                const topNum = (i * 3) + 2;
                                const bottomNum = (i * 3) + 1;
                                const isSelected = hasBet(CasinoBetType.SPLIT, [bottomNum, topNum]);
                                return (
                                    <div key={`split-h2-${i}`} className="absolute z-30 w-full h-4 -bottom-2 cursor-pointer group"
                                        style={{ gridColumnStart: i + 2, gridRowStart: 2, top: 'calc(100% - 8px)' }}
                                        onClick={() => addBet(CasinoBetType.SPLIT, `Split ${bottomNum}-${topNum}`, [bottomNum, topNum])}
                                    >
                                        <div className={`w-4 h-4 mx-auto rounded-full transition-colors ${isSelected ? 'bg-amber-400 ring-2 ring-white' : 'group-hover:bg-white/50'}`} />
                                    </div>
                                );
                            })}

                            {/* Vertical Splits (Between Columns) */}
                            {[...Array(11)].map((_, i) => {
                                return [1, 2, 3].map(rowOffset => {
                                    let leftN: number, rightN: number;
                                    if (rowOffset === 3) { leftN = (i * 3) + 3; rightN = leftN + 3; }
                                    else if (rowOffset === 2) { leftN = (i * 3) + 2; rightN = leftN + 3; }
                                    else { leftN = (i * 3) + 1; rightN = leftN + 3; }
                                    const gridRow = rowOffset === 3 ? 1 : rowOffset === 2 ? 2 : 3;
                                    const isSelected = hasBet(CasinoBetType.SPLIT, [leftN, rightN]);

                                    return (
                                        <div key={`split-v-${i}-${rowOffset}`} className="absolute z-30 h-full w-4 -right-2 cursor-pointer group flex items-center justify-center"
                                            style={{ gridColumnStart: i + 2, gridRowStart: gridRow, left: '100%', transform: 'translateX(-50%)' }}
                                            onClick={() => addBet(CasinoBetType.SPLIT, `Split ${leftN}-${rightN}`, [leftN, rightN])}
                                        >
                                            <div className={`w-3 h-3 rounded-full transition-colors ${isSelected ? 'bg-amber-400 ring-2 ring-white' : 'group-hover:bg-white/50'}`} />
                                        </div>
                                    );
                                });
                            })}

                            {/* Corners */}
                            {[...Array(11)].map((_, i) => {
                                const topLeft = (i * 3) + 3; const topRight = topLeft + 3;
                                const bottomLeft = (i * 3) + 2; const bottomRight = bottomLeft + 3;
                                const numsTop = [topLeft, topRight, bottomLeft, bottomRight];
                                const isSelectedTop = hasBet(CasinoBetType.CORNER, numsTop);

                                const topLeft2 = (i * 3) + 2; const topRight2 = topLeft2 + 3;
                                const bottomLeft2 = (i * 3) + 1; const bottomRight2 = bottomLeft2 + 3;
                                const numsBot = [topLeft2, topRight2, bottomLeft2, bottomRight2];
                                const isSelectedBot = hasBet(CasinoBetType.CORNER, numsBot);

                                return (
                                    <React.Fragment key={`corners-${i}`}>
                                        <div className="absolute z-40 w-6 h-6 cursor-pointer group flex items-center justify-center pointer-events-auto"
                                            style={{ gridColumnStart: i + 2, gridRowStart: 1, top: '100%', left: '100%', transform: 'translate(-50%, -50%)' }}
                                            onClick={() => addBet(CasinoBetType.CORNER, `Corner ${numsTop.join(',')}`, numsTop)}
                                        >
                                            <div className={`w-4 h-4 rounded-full transition-colors ${isSelectedTop ? 'bg-amber-400 ring-2 ring-white' : 'group-hover:bg-blue-400/80'}`} />
                                        </div>
                                        <div className="absolute z-40 w-6 h-6 cursor-pointer group flex items-center justify-center pointer-events-auto"
                                            style={{ gridColumnStart: i + 2, gridRowStart: 2, top: '100%', left: '100%', transform: 'translate(-50%, -50%)' }}
                                            onClick={() => addBet(CasinoBetType.CORNER, `Corner ${numsBot.join(',')}`, numsBot)}
                                        >
                                            <div className={`w-4 h-4 rounded-full transition-colors ${isSelectedBot ? 'bg-amber-400 ring-2 ring-white' : 'group-hover:bg-blue-400/80'}`} />
                                        </div>
                                    </React.Fragment>
                                );
                            })}

                            {/* Street Bets */}
                            {[...Array(12)].map((_, i) => {
                                const streetNums = [(i * 3) + 1, (i * 3) + 2, (i * 3) + 3];
                                const isSelected = hasBet(CasinoBetType.STREET, streetNums);
                                return (
                                    <div key={`street-${i}`} className="absolute z-20 w-full h-6 -top-4 cursor-pointer group flex items-center justify-center"
                                        style={{ gridColumnStart: i + 2, gridRowStart: 1, transform: 'translateY(-50%)' }}
                                        onClick={() => addBet(CasinoBetType.STREET, `Street ${streetNums[0]}-${streetNums[2]}`, streetNums)}
                                    >
                                        <div className={`w-8 h-2 rounded transition-colors ${isSelected ? 'bg-amber-400 ring-2 ring-white' : 'group-hover:bg-purple-400/50'}`} />
                                    </div>
                                );
                            })}

                            {/* Six Line (Double Street) */}
                            {[...Array(11)].map((_, i) => {
                                const s1Start = (i * 3) + 1;
                                const s2Start = ((i + 1) * 3) + 1;
                                const nums = [s1Start, s1Start + 1, s1Start + 2, s2Start, s2Start + 1, s2Start + 2];
                                const isSelected = hasBet(CasinoBetType.SIX_LINE, nums);
                                return (
                                    <div key={`sixline-${i}`} className="absolute z-50 w-6 h-6 -top-4 cursor-pointer group flex items-center justify-center pointer-events-auto"
                                        style={{ gridColumnStart: i + 2, gridRowStart: 1, left: '100%', transform: 'translate(-50%, -50%)' }}
                                        onClick={() => addBet(CasinoBetType.SIX_LINE, `6-Line ${s1Start}-${s2Start + 2}`, nums)}
                                    >
                                        <div className={`w-3 h-3 rounded-full transition-colors ${isSelected ? 'bg-amber-400 ring-2 ring-white' : 'group-hover:bg-orange-400/80'}`} />
                                    </div>
                                );
                            })}

                        </div>

                        {/* Dozens - FIXED: Use 1, 2, 3 not 1, 13, 25 */}
                        <div className="grid grid-cols-[30px_repeat(3,1fr)_30px] md:grid-cols-[40px_repeat(3,1fr)_40px] gap-0.5 md:gap-1 mt-1">
                            <div className="col-start-2 col-span-1">
                                <button
                                    onClick={() => addBet(CasinoBetType.DOZEN, '1st 12', [1])}
                                    className={`w-full py-1.5 md:py-2 rounded text-[10px] md:text-xs font-bold text-foreground transition-all border border-border 
                                        ${hasBet(CasinoBetType.DOZEN, [1]) ? 'ring-2 ring-primary bg-primary/20' : 'bg-transparent hover:bg-muted'}`}
                                >
                                    1st 12
                                </button>
                            </div>
                            <div className="col-span-1">
                                <button
                                    onClick={() => addBet(CasinoBetType.DOZEN, '2nd 12', [2])}
                                    className={`w-full py-1.5 md:py-2 rounded text-[10px] md:text-xs font-bold text-foreground transition-all border border-border 
                                        ${hasBet(CasinoBetType.DOZEN, [2]) ? 'ring-2 ring-primary bg-primary/20' : 'bg-transparent hover:bg-muted'}`}
                                >
                                    2nd 12
                                </button>
                            </div>
                            <div className="col-span-1">
                                <button
                                    onClick={() => addBet(CasinoBetType.DOZEN, '3rd 12', [3])}
                                    className={`w-full py-1.5 md:py-2 rounded text-[10px] md:text-xs font-bold text-foreground transition-all border border-border 
                                        ${hasBet(CasinoBetType.DOZEN, [3]) ? 'ring-2 ring-primary bg-primary/20' : 'bg-transparent hover:bg-muted'}`}
                                >
                                    3rd 12
                                </button>
                            </div>
                        </div>

                        {/* Outside Bets */}
                        <div className="grid grid-cols-[30px_repeat(6,1fr)_30px] md:grid-cols-[40px_repeat(6,1fr)_40px] gap-0.5 md:gap-1">
                            <div className="col-start-2 col-span-1">
                                <button
                                    onClick={() => addBet(CasinoBetType.LOW, '1-18', [])}
                                    className={`w-full h-8 md:h-12 rounded text-[9px] md:text-xs font-bold text-foreground transition-all border border-border 
                                        ${hasBet(CasinoBetType.LOW, []) ? 'ring-2 ring-primary bg-primary/20' : 'bg-transparent hover:bg-muted'}`}
                                >
                                    1-18
                                </button>
                            </div>
                            <div className="col-span-1">
                                <button
                                    onClick={() => addBet(CasinoBetType.EVEN, 'EVEN', [])}
                                    className={`w-full h-8 md:h-12 rounded text-[9px] md:text-xs font-bold text-foreground transition-all border border-border 
                                        ${hasBet(CasinoBetType.EVEN, []) ? 'ring-2 ring-primary bg-primary/20' : 'bg-transparent hover:bg-muted'}`}
                                >
                                    EVEN
                                </button>
                            </div>
                            <div className="col-span-1">
                                <button
                                    onClick={() => addBet(CasinoBetType.RED, 'RED', [])}
                                    className={`w-full h-8 md:h-12 rounded flex items-center justify-center transition-all border border-white/10 bg-red-600 
                                        ${hasBet(CasinoBetType.RED, []) ? 'ring-2 ring-amber-400 scale-105' : 'hover:brightness-110'}`}
                                >
                                    <div className="w-3 h-3 md:w-4 md:h-4 rotate-45 border border-white/20 bg-red-600" />
                                </button>
                            </div>
                            <div className="col-span-1">
                                <button
                                    onClick={() => addBet(CasinoBetType.BLACK, 'BLACK', [])}
                                    className={`w-full h-8 md:h-12 rounded flex items-center justify-center transition-all border border-white/10 bg-gray-900 
                                        ${hasBet(CasinoBetType.BLACK, []) ? 'ring-2 ring-amber-400 scale-105' : 'hover:brightness-110'}`}
                                >
                                    <div className="w-3 h-3 md:w-4 md:h-4 rotate-45 border border-white/20 bg-gray-900" />
                                </button>
                            </div>
                            <div className="col-span-1">
                                <button
                                    onClick={() => addBet(CasinoBetType.ODD, 'ODD', [])}
                                    className={`w-full h-8 md:h-12 rounded text-[9px] md:text-xs font-bold text-foreground transition-all border border-border 
                                        ${hasBet(CasinoBetType.ODD, []) ? 'ring-2 ring-primary bg-primary/20' : 'bg-transparent hover:bg-muted'}`}
                                >
                                    ODD
                                </button>
                            </div>
                            <div className="col-span-1">
                                <button
                                    onClick={() => addBet(CasinoBetType.HIGH, '19-36', [])}
                                    className={`w-full h-8 md:h-12 rounded text-[9px] md:text-xs font-bold text-foreground transition-all border border-border 
                                        ${hasBet(CasinoBetType.HIGH, []) ? 'ring-2 ring-primary bg-primary/20' : 'bg-transparent hover:bg-muted'}`}
                                >
                                    19-36
                                </button>
                            </div>
                        </div>
                    </div>
                    {/* ===== END BETTING TABLE ===== */}

                    {/* Action Buttons */}
                    <div className="space-y-2">
                        {!hasApproval ? (
                            <ApproveTransaction
                                spenderAddress={LAND_CONTRACT_ADDRESS}
                                tokenAddress={(config?.bettingToken || PIXOTCHI_TOKEN_ADDRESS) as `0x${string}`}
                                onSuccess={refreshApproval}
                                buttonText="Approve Betting Token"
                                buttonClassName="w-full"
                            />
                        ) : (
                            <Button
                                className="w-full"
                                onClick={pendingGame ? handleReveal : handleSpin}
                                disabled={(placedBets.length === 0 && !pendingGame) || isSpinning || !walletClient || (isInsufficientBalance && !pendingGame)}
                                variant={isInsufficientBalance && !pendingGame ? "destructive" : "default"}
                            >
                                {isSpinning ? (
                                    <>
                                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                        {spinPhase === 'betting' && 'Placing bets...'}
                                        {spinPhase === 'waiting' && 'Waiting...'}
                                        {spinPhase === 'revealing' && 'Revealing...'}
                                    </>
                                ) : pendingGame ? (
                                    "Resume Spin (Reveal Result)"
                                ) : isInsufficientBalance ? (
                                    "Insufficient Balance"
                                ) : placedBets.length === 0 ? (
                                    "Select bets to spin"
                                ) : (
                                    `🎲 Spin (${totalBetAmount.toFixed(2)} SEED total)`
                                )}
                            </Button>
                        )}

                        {error && (
                            <p className="text-xs text-destructive text-center">{error}</p>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
