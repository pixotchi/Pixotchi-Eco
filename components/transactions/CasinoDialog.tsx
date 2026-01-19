"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, X } from 'lucide-react';
import { parseUnits, formatUnits, decodeEventLog } from 'viem';
import { useWalletClient, usePublicClient, useAccount, useBalance } from 'wagmi';
import {
    casinoPlaceBet,
    casinoReveal,
    casinoGetActiveBet,

    casinoGetConfig,
    checkCasinoApproval,
    LAND_CONTRACT_ADDRESS,
    PIXOTCHI_TOKEN_ADDRESS,
} from '@/lib/contracts';
import { casinoAbi, CasinoBetType, CASINO_PAYOUT_MULTIPLIERS, RED_NUMBERS } from '@/public/abi/casino-abi';
import ApproveTransaction from './approve-transaction';
import SponsoredTransaction from './sponsored-transaction';
import { toast } from 'react-hot-toast';

interface CasinoDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    landId: bigint;
    onSpinComplete?: () => void;
}

// Roulette wheel numbers in order (European)
const WHEEL_NUMBERS = [
    0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
    5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26
];

// Bet options type definition
interface BetOption {
    type: CasinoBetType;
    label: string;
    payout: string;
    requiresNumber?: boolean;
    numbers?: number[];
    color?: string;
}

// Bet options for the UI (kept for Straight bet reference which is index 0)
const BET_OPTIONS: BetOption[] = [
    { type: CasinoBetType.STRAIGHT, label: 'Single Number', payout: '35:1', requiresNumber: true },
];

export default function CasinoDialog({ open, onOpenChange, landId, onSpinComplete }: CasinoDialogProps) {
    const { data: walletClient } = useWalletClient();
    const publicClient = usePublicClient();
    const { address } = useAccount();

    // Game state
    const [selectedBet, setSelectedBet] = useState<BetOption | null>(null);
    const [selectedNumber, setSelectedNumber] = useState<number | null>(null);
    const [betAmount, setBetAmount] = useState('10');
    const [isSpinning, setIsSpinning] = useState(false);
    const [spinPhase, setSpinPhase] = useState<'idle' | 'betting' | 'waiting' | 'revealing'>('idle');
    const [result, setResult] = useState<{ number: number; won: boolean; payout: string } | null>(null);
    const [wheelRotation, setWheelRotation] = useState(0);

    // Config & approval
    const [config, setConfig] = useState<{ minBet: bigint; maxBet: bigint; bettingToken: string } | null>(null);
    const [hasApproval, setHasApproval] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [pendingGame, setPendingGame] = useState<boolean>(false);



    // Get token balance
    const { data: balanceData } = useBalance({
        address: address,
        token: config?.bettingToken as `0x${string}` || PIXOTCHI_TOKEN_ADDRESS,
        query: {
            enabled: !!address,
        }
    });

    // Validations
    const amountVal = parseFloat(betAmount || '0');
    const balanceVal = balanceData ? parseFloat(formatUnits(balanceData.value, balanceData.decimals)) : 0;
    const isInsufficientBalance = amountVal > balanceVal;

    // Load config and approval status
    useEffect(() => {
        const loadConfig = async () => {
            try {
                // First load config
                const cfg = await casinoGetConfig();
                const bettingToken = cfg?.bettingToken || PIXOTCHI_TOKEN_ADDRESS;

                if (cfg) {
                    setConfig({
                        minBet: cfg.minBet,
                        maxBet: cfg.maxBet,
                        bettingToken: bettingToken
                    });
                }

                // Check for active game
                if (landId) {
                    try {
                        const activeGame = await casinoGetActiveBet(landId);
                        if (activeGame && activeGame.isActive) {
                            setPendingGame(true);
                            setSpinPhase('revealing');

                            // Reconstruct partial state if possible or just let them reveal
                            if (activeGame.betAmount) {
                                setBetAmount(formatUnits(activeGame.betAmount, 18));
                            }
                        }
                    } catch (e) {
                        console.error('Failed to check active game:', e);
                    }
                }



                // then check approval
                if (address) {
                    const approval = await checkCasinoApproval(address, bettingToken);
                    setHasApproval(approval > BigInt(0));
                }
            } catch (e) {
                console.error('Failed to load casino config:', e);
            }
        };
        if (open) loadConfig();
    }, [open, address]);

    // Wheel animation during spin
    useEffect(() => {
        if (!isSpinning) return;

        const interval = setInterval(() => {
            setWheelRotation(prev => (prev + 15) % 360);
        }, 50);

        return () => clearInterval(interval);
    }, [isSpinning]);

    // Shared reveal logic
    const handleReveal = useCallback(async () => {
        if (!walletClient || !publicClient) return;

        try {
            setSpinPhase('revealing');

            // Reveal
            const hash = await casinoReveal(walletClient, landId);
            const receipt = await publicClient.waitForTransactionReceipt({ hash: hash as `0x${string}` });

            // Parse result from logs
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
                } catch {
                    continue;
                }
            }

            if (spinResult) {
                const { winningNumber, won, payout } = spinResult as any;
                setResult({
                    number: Number(winningNumber),
                    won: won,
                    payout: formatUnits(payout, 18)
                });

                // Stop wheel at winning number position
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
                // If expired, maybe show that context?
            }

            setPendingGame(false);
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



    // Handle spin
    const handleSpin = useCallback(async () => {
        if (!walletClient || !publicClient || !selectedBet) return;

        setError(null);
        setIsSpinning(true);
        setResult(null);
        setSpinPhase('betting');

        try {
            // Determine bet numbers
            let betNumbers: number[];
            if (selectedBet.requiresNumber && selectedNumber !== null) {
                betNumbers = [selectedNumber];
            } else if (selectedBet.numbers) {
                betNumbers = selectedBet.numbers;
            } else {
                betNumbers = [];
            }

            const betAmountWei = parseUnits(betAmount, 18);

            // Place bet
            await casinoPlaceBet(walletClient, landId, selectedBet.type, betNumbers, betAmountWei);
            toast.success('Bet placed! Waiting for block...');

            setSpinPhase('waiting');

            // Wait for reveal block (contract requires waiting ~3 blocks)
            await new Promise(resolve => setTimeout(resolve, 9000));

            // Execute reveal
            await handleReveal();

        } catch (err: any) {
            console.error('Spin failed:', err);
            setError(err.message || 'Spin failed');
            toast.error('Spin failed');
            setIsSpinning(false);
            setSpinPhase('idle');
        }
    }, [walletClient, publicClient, selectedBet, selectedNumber, betAmount, landId, handleReveal]);

    // Check approval status
    const refreshApproval = useCallback(async () => {
        if (address) {
            const token = config?.bettingToken || PIXOTCHI_TOKEN_ADDRESS;
            const approval = await checkCasinoApproval(address, token);
            setHasApproval(approval > BigInt(0));
        }
    }, [address, config]);

    // Helper to check if a bet is active
    const isBetActive = (type: CasinoBetType, numbers: number[]) => {
        if (!selectedBet) return false;
        if (selectedBet.type !== type) return false;
        // Compare sorted arrays
        const sortedSelected = [...(selectedBet.numbers || [])].sort((a, b) => a - b);
        const sortedTarget = [...numbers].sort((a, b) => a - b);
        return JSON.stringify(sortedSelected) === JSON.stringify(sortedTarget);
    };

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
                    </DialogTitle>
                </DialogHeader>

                <div className="space-y-4 relative">
                    {/* Roulette Wheel */}
                    <div className="flex justify-center">
                        <div className="relative w-48 h-48">
                            {/* Wheel */}
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
                            {/* Ball indicator */}
                            <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1">
                                <div className="w-3 h-3 bg-white rounded-full border border-gray-400 shadow-md" />
                            </div>
                            {/* Result display */}
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
                            {spinPhase === 'betting' && 'Placing bet...'}
                            {spinPhase === 'waiting' && 'Waiting for reveal block...'}
                            {spinPhase === 'revealing' && 'Revealing result...'}
                        </div>
                    )}

                    {/* Result */}
                    {result && !isSpinning && (
                        <div className={`text-center p-3 rounded-lg ${result.won ? 'bg-primary/10 text-primary border border-primary/20' : 'bg-muted text-muted-foreground border border-border'}`}>
                            <div className="font-bold">
                                {result.won ? `🎉 Won ${result.payout} SEED!` : 'No win this time'}
                            </div>
                            <div className="text-sm">Winning number: {result.number}</div>
                        </div>
                    )}

                    {/* Betting Table Container */}
                    <div className="flex flex-col gap-1 select-none w-full relative">
                        {/* THE GRID */}
                        <div className="grid grid-cols-[30px_repeat(12,1fr)_30px] md:grid-cols-[40px_repeat(12,1fr)_40px] gap-0.5 md:gap-1 relative z-10">

                            {/* Zero - Spans 3 rows */}
                            <button
                                onClick={() => { setSelectedBet({ type: CasinoBetType.STRAIGHT, label: '0', payout: '35:1', numbers: [0] }); setSelectedNumber(0); }}
                                className={`row-span-3 flex items-center justify-center rounded text-[10px] md:text-sm font-bold text-white transition-all border border-white/10 ${selectedNumber === 0 ? 'ring-2 ring-amber-400 scale-105 z-20' : 'hover:brightness-110'
                                    } bg-green-600 min-w-0`}
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
                                        onClick={() => { setSelectedBet({ type: CasinoBetType.STRAIGHT, label: `${num}`, payout: '35:1', numbers: [num] }); setSelectedNumber(num); }}
                                        className={`h-10 md:h-14 flex items-center justify-center rounded text-[10px] md:text-sm font-bold text-white transition-all border border-white/10 ${selectedNumber === num ? 'ring-2 ring-amber-400 scale-105 z-20' : 'hover:brightness-110'
                                            } ${isRed ? 'bg-red-600' : 'bg-gray-900'} min-w-0 relative`}
                                    >
                                        {num}
                                    </button>
                                );
                            })}

                            {/* 2to1 (Column 3) */}
                            <button
                                onClick={() => { setSelectedBet({ type: CasinoBetType.COLUMN, label: '3rd Col', payout: '2:1', numbers: [3] }); setSelectedNumber(null); }}
                                className={`h-10 md:h-14 flex items-center justify-center rounded text-[8px] md:text-xs font-bold text-foreground transition-all border border-border ${selectedBet?.type === CasinoBetType.COLUMN && selectedBet?.numbers?.[0] === 3 ? 'ring-2 ring-primary bg-primary/20' : 'bg-transparent hover:bg-muted'
                                    } min-w-0`}
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
                                        onClick={() => { setSelectedBet({ type: CasinoBetType.STRAIGHT, label: `${num}`, payout: '35:1', numbers: [num] }); setSelectedNumber(num); }}
                                        className={`h-10 md:h-14 flex items-center justify-center rounded text-[10px] md:text-sm font-bold text-white transition-all border border-white/10 ${selectedNumber === num ? 'ring-2 ring-amber-400 scale-105 z-20' : 'hover:brightness-110'
                                            } ${isRed ? 'bg-red-600' : 'bg-gray-900'} min-w-0 relative`}
                                    >
                                        {num}
                                    </button>
                                );
                            })}

                            {/* 2to1 (Column 2) */}
                            <button
                                onClick={() => { setSelectedBet({ type: CasinoBetType.COLUMN, label: '2nd Col', payout: '2:1', numbers: [2] }); setSelectedNumber(null); }}
                                className={`h-10 md:h-14 flex items-center justify-center rounded text-[8px] md:text-xs font-bold text-foreground transition-all border border-border ${selectedBet?.type === CasinoBetType.COLUMN && selectedBet?.numbers?.[0] === 2 ? 'ring-2 ring-primary bg-primary/20' : 'bg-transparent hover:bg-muted'
                                    } min-w-0`}
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
                                        onClick={() => { setSelectedBet({ type: CasinoBetType.STRAIGHT, label: `${num}`, payout: '35:1', numbers: [num] }); setSelectedNumber(num); }}
                                        className={`h-10 md:h-14 flex items-center justify-center rounded text-[10px] md:text-sm font-bold text-white transition-all border border-white/10 ${selectedNumber === num ? 'ring-2 ring-amber-400 scale-105 z-20' : 'hover:brightness-110'
                                            } ${isRed ? 'bg-red-600' : 'bg-gray-900'} min-w-0 relative`}
                                    >
                                        {num}
                                    </button>
                                );
                            })}

                            {/* 2to1 (Column 1) */}
                            <button
                                onClick={() => { setSelectedBet({ type: CasinoBetType.COLUMN, label: '1st Col', payout: '2:1', numbers: [1] }); setSelectedNumber(null); }}
                                className={`h-10 md:h-14 flex items-center justify-center rounded text-[8px] md:text-xs font-bold text-foreground transition-all border border-border ${selectedBet?.type === CasinoBetType.COLUMN && selectedBet?.numbers?.[0] === 1 ? 'ring-2 ring-primary bg-primary/20' : 'bg-transparent hover:bg-muted'
                                    } min-w-0`}
                            >
                                <span className="-rotate-90 whitespace-nowrap">2to1</span>
                            </button>

                            {/* --- OVERLAYS FOR COMPLEX BETS --- */}

                            {/* Horizontal Splits (Between Rows) */}
                            {/* Between 3rd and 2nd row */}
                            {[...Array(12)].map((_, i) => {
                                const topNum = (i * 3) + 3;
                                const bottomNum = (i * 3) + 2;
                                const isSelected = isBetActive(CasinoBetType.SPLIT, [bottomNum, topNum]);
                                return (
                                    <div key={`split-h-${i}`} className="absolute z-30 w-full h-4 -bottom-2 cursor-pointer group"
                                        style={{
                                            gridColumnStart: i + 2,
                                            gridRowStart: 1,
                                            top: 'calc(100% - 8px)'
                                        }}
                                        onClick={() => { setSelectedBet({ type: CasinoBetType.SPLIT, label: 'Split', payout: '17:1', numbers: [bottomNum, topNum] }); setSelectedNumber(null); }}
                                    >
                                        <div className={`w-4 h-4 mx-auto rounded-full transition-colors ${isSelected ? 'bg-amber-400 ring-2 ring-white' : 'group-hover:bg-white/50'}`} />
                                    </div>
                                );
                            })}

                            {/* Between 2nd and 1st row */}
                            {[...Array(12)].map((_, i) => {
                                const topNum = (i * 3) + 2;
                                const bottomNum = (i * 3) + 1;
                                const isSelected = isBetActive(CasinoBetType.SPLIT, [bottomNum, topNum]);
                                return (
                                    <div key={`split-h2-${i}`} className="absolute z-30 w-full h-4 -bottom-2 cursor-pointer group"
                                        style={{
                                            gridColumnStart: i + 2,
                                            gridRowStart: 2,
                                            top: 'calc(100% - 8px)'
                                        }}
                                        onClick={() => { setSelectedBet({ type: CasinoBetType.SPLIT, label: 'Split', payout: '17:1', numbers: [bottomNum, topNum] }); setSelectedNumber(null); }}
                                    >
                                        <div className={`w-4 h-4 mx-auto rounded-full transition-colors ${isSelected ? 'bg-amber-400 ring-2 ring-white' : 'group-hover:bg-white/50'}`} />
                                    </div>
                                );
                            })}

                            {/* Vertical Splits (Between Columns) */}
                            {/* We have 11 vertical lines between 12 columns. Each line spans 3 rows. */}
                            {/* Actually we just place individual split zones between pairs */}
                            {[...Array(11)].map((_, i) => {
                                // For each row (1, 2, 3)
                                return [1, 2, 3].map(rowOffset => {
                                    const leftNum = (i * 3) + 4 - rowOffset; // Logic: i=0, row=0(top) -> 3. Wait. Row 1 is bottom (1). Row 3 is top (3).
                                    // Let's use simple logic:
                                    // Row 3 (top): 3, 6, 9...
                                    // Row 2 (mid): 2, 5, 8...
                                    // Row 1 (bot): 1, 4, 7...

                                    let leftN: number, rightN: number;
                                    if (rowOffset === 3) { // Top
                                        leftN = (i * 3) + 3;
                                        rightN = leftN + 3;
                                    } else if (rowOffset === 2) { // Mid
                                        leftN = (i * 3) + 2;
                                        rightN = leftN + 3;
                                    } else { // Bot
                                        leftN = (i * 3) + 1;
                                        rightN = leftN + 3;
                                    }

                                    // Grid row calculation: Top is 1, Mid is 2, Bot is 3
                                    const gridRow = rowOffset === 3 ? 1 : rowOffset === 2 ? 2 : 3;

                                    const isSelected = isBetActive(CasinoBetType.SPLIT, [leftN, rightN]);

                                    return (
                                        <div key={`split-v-${i}-${rowOffset}`} className="absolute z-30 h-full w-4 -right-2 cursor-pointer group flex items-center justify-center"
                                            style={{
                                                gridColumnStart: i + 2,
                                                gridRowStart: gridRow,
                                                left: '100%',
                                                transform: 'translateX(-50%)'
                                            }}
                                            onClick={() => { setSelectedBet({ type: CasinoBetType.SPLIT, label: 'Split', payout: '17:1', numbers: [leftN, rightN] }); setSelectedNumber(null); }}
                                        >
                                            <div className={`w-3 h-3 rounded-full transition-colors ${isSelected ? 'bg-amber-400 ring-2 ring-white' : 'group-hover:bg-white/50'}`} />
                                        </div>
                                    );
                                });
                            })}

                            {/* Corners (Intersections) */}
                            {/* Between every intersection of 4 numbers */}
                            {/* columns 0..10 (11 gaps), rows 1..2 (2 gaps) */}
                            {[...Array(11)].map((_, i) => {
                                // i corresponds to gap between col i and col i+1
                                // Check Top Intersections (between row 3 and 2)
                                const topLeft = (i * 3) + 3;
                                const topRight = topLeft + 3;
                                const bottomLeft = (i * 3) + 2;
                                const bottomRight = bottomLeft + 3;
                                const numsTop = [topLeft, topRight, bottomLeft, bottomRight];
                                const isSelectedTop = isBetActive(CasinoBetType.CORNER, numsTop);

                                // Check Bottom Intersections (between row 2 and 1)
                                const topLeft2 = (i * 3) + 2;
                                const topRight2 = topLeft2 + 3;
                                const bottomLeft2 = (i * 3) + 1;
                                const bottomRight2 = bottomLeft2 + 3;
                                const numsBot = [topLeft2, topRight2, bottomLeft2, bottomRight2];
                                const isSelectedBot = isBetActive(CasinoBetType.CORNER, numsBot);

                                return (
                                    <React.Fragment key={`corners-${i}`}>
                                        {/* Top Corner */}
                                        <div className="absolute z-40 w-6 h-6 cursor-pointer group flex items-center justify-center pointer-events-auto"
                                            style={{
                                                gridColumnStart: i + 2,
                                                gridRowStart: 1,
                                                top: '100%',
                                                left: '100%',
                                                transform: 'translate(-50%, -50%)'
                                            }}
                                            onClick={() => { setSelectedBet({ type: CasinoBetType.CORNER, label: 'Corner', payout: '8:1', numbers: numsTop }); setSelectedNumber(null); }}
                                        >
                                            <div className={`w-4 h-4 rounded-full transition-colors ${isSelectedTop ? 'bg-amber-400 ring-2 ring-white' : 'group-hover:bg-blue-400/80'}`} />
                                        </div>

                                        {/* Bottom Corner */}
                                        <div className="absolute z-40 w-6 h-6 cursor-pointer group flex items-center justify-center pointer-events-auto"
                                            style={{
                                                gridColumnStart: i + 2,
                                                gridRowStart: 2,
                                                top: '100%',
                                                left: '100%',
                                                transform: 'translate(-50%, -50%)'
                                            }}
                                            onClick={() => { setSelectedBet({ type: CasinoBetType.CORNER, label: 'Corner', payout: '8:1', numbers: numsBot }); setSelectedNumber(null); }}
                                        >
                                            <div className={`w-4 h-4 rounded-full transition-colors ${isSelectedBot ? 'bg-amber-400 ring-2 ring-white' : 'group-hover:bg-blue-400/80'}`} />
                                        </div>
                                    </React.Fragment>
                                );
                            })}

                            {/* STREET BETS (Left Side) */}
                            {/* Rows: 1, 4, 7... */}
                            {/* But mapped to grid rows 3 (top), 2 (mid), 1 (bot) */}
                            {[1, 2, 3].map(row => {
                                // If row 1 (grid row 3), numbers starting at 1, 4, 7... No wait.
                                // Grid Row 1 (Top) -> Starts at 3.
                                // Grid Row 2 (Mid) -> Starts at 2.
                                // Grid Row 3 (Bot) -> Starts at 1.
                                return [...Array(12)].map((_, i) => {
                                    let startNum;
                                    if (row === 1) startNum = (i * 3) + 3; // Top
                                    else if (row === 2) startNum = (i * 3) + 2; // Mid
                                    else startNum = (i * 3) + 1; // Bot

                                    // Street is 3 consecutive numbers vertical? NO.
                                    // Street (Row) 11:1 -> 3 numbers (e.g. 1,2,3).
                                    // Vertically on the board, they are 1-2-3 (from bot to top).
                                    // Wait, standard roulette layout:
                                    // Col 1: 1, 2, 3
                                    // Col 2: 4, 5, 6
                                    // So a "Street" is an entire vertical column on the visual board (which corresponds to 3 sequential numbers).
                                    // Wait, my grid is rotated? 
                                    // Standard: 
                                    // 3  6  9
                                    // 2  5  8
                                    // 1  4  7
                                    // A Street bet is usually placed at the BOTTOM of the column (below 1) or TOP (above 3)?
                                    // "A bet on three numbers in a vertical line (a street)". 
                                    // Wait, 1,2,3 is a street. 4,5,6 is a street.
                                    // In MY grid, 1,2,3 is a COLUMN (visually). 
                                    // So Street 1 (1,2,3) is that entire column.
                                    const streetNums = [(i * 3) + 1, (i * 3) + 2, (i * 3) + 3];
                                    const isSelected = isBetActive(CasinoBetType.STREET, streetNums);

                                    // Place hitbox above the top number (3)
                                    if (row === 1) { // Only render once per column (at top)
                                        return (
                                            <div key={`street-${i}`} className="absolute z-20 w-full h-6 -top-4 cursor-pointer group flex items-center justify-center"
                                                style={{
                                                    gridColumnStart: i + 2,
                                                    gridRowStart: 1,
                                                    transform: 'translateY(-50%)'
                                                }}
                                                onClick={() => { setSelectedBet({ type: CasinoBetType.STREET, label: 'Street', payout: '11:1', numbers: streetNums }); setSelectedNumber(null); }}
                                            >
                                                <div className={`w-8 h-2 rounded transition-colors ${isSelected ? 'bg-amber-400 ring-2 ring-white' : 'group-hover:bg-purple-400/50'}`} />
                                            </div>
                                        );
                                    }
                                    return null;
                                });
                            })}

                            {/* SIX LINE (Double Street) - 5:1 */}
                            {/* Between two streets (columns) at the top */}
                            {[...Array(11)].map((_, i) => {
                                // Street 1: i, Street 2: i+1
                                const s1Start = (i * 3) + 1; // 1
                                const s2Start = ((i + 1) * 3) + 1; // 4
                                const nums = [s1Start, s1Start + 1, s1Start + 2, s2Start, s2Start + 1, s2Start + 2];
                                const isSelected = isBetActive(CasinoBetType.SIX_LINE, nums);

                                return (
                                    <div key={`sixline-${i}`} className="absolute z-50 w-6 h-6 -top-4 cursor-pointer group flex items-center justify-center pointer-events-auto"
                                        style={{
                                            gridColumnStart: i + 2,
                                            gridRowStart: 1,
                                            left: '100%',
                                            transform: 'translate(-50%, -50%)'
                                        }}
                                        onClick={() => { setSelectedBet({ type: CasinoBetType.SIX_LINE, label: 'Six Line', payout: '5:1', numbers: nums }); setSelectedNumber(null); }}
                                    >
                                        <div className={`w-3 h-3 rounded-full transition-colors ${isSelected ? 'bg-amber-400 ring-2 ring-white' : 'group-hover:bg-orange-400/80'}`} />
                                    </div>
                                );
                            })}

                        </div>

                        {/* Middle Section: Dozens */}
                        <div className="grid grid-cols-[30px_repeat(3,1fr)_30px] md:grid-cols-[40px_repeat(3,1fr)_40px] gap-0.5 md:gap-1 mt-1">
                            <div className="col-start-2 col-span-1">
                                <button
                                    onClick={() => { setSelectedBet({ type: CasinoBetType.DOZEN, label: '1st 12', payout: '2:1', numbers: [1] }); setSelectedNumber(null); }}
                                    className={`w-full py-1.5 md:py-2 rounded text-[10px] md:text-xs font-bold text-foreground transition-all border border-border ${selectedBet?.type === CasinoBetType.DOZEN && selectedBet?.numbers?.[0] === 1 ? 'ring-2 ring-primary bg-primary/20' : 'bg-transparent hover:bg-muted'
                                        }`}
                                >
                                    1st 12
                                </button>
                            </div>
                            <div className="col-span-1">
                                <button
                                    onClick={() => { setSelectedBet({ type: CasinoBetType.DOZEN, label: '2nd 12', payout: '2:1', numbers: [13] }); setSelectedNumber(null); }}
                                    className={`w-full py-1.5 md:py-2 rounded text-[10px] md:text-xs font-bold text-foreground transition-all border border-border ${selectedBet?.type === CasinoBetType.DOZEN && selectedBet?.numbers?.[0] === 13 ? 'ring-2 ring-primary bg-primary/20' : 'bg-transparent hover:bg-muted'
                                        }`}
                                >
                                    2nd 12
                                </button>
                            </div>
                            <div className="col-span-1">
                                <button
                                    onClick={() => { setSelectedBet({ type: CasinoBetType.DOZEN, label: '3rd 12', payout: '2:1', numbers: [25] }); setSelectedNumber(null); }}
                                    className={`w-full py-1.5 md:py-2 rounded text-[10px] md:text-xs font-bold text-foreground transition-all border border-border ${selectedBet?.type === CasinoBetType.DOZEN && selectedBet?.numbers?.[0] === 25 ? 'ring-2 ring-primary bg-primary/20' : 'bg-transparent hover:bg-muted'
                                        }`}
                                >
                                    3rd 12
                                </button>
                            </div>
                        </div>

                        {/* Bottom Section: Outside Bets */}
                        <div className="grid grid-cols-[30px_repeat(6,1fr)_30px] md:grid-cols-[40px_repeat(6,1fr)_40px] gap-0.5 md:gap-1">
                            {/* Spacer to align with numbers */}
                            <div className="col-start-2 col-span-1">
                                <button
                                    onClick={() => { setSelectedBet({ type: CasinoBetType.LOW, label: '1-18', payout: '1:1' }); setSelectedNumber(null); }}
                                    className={`w-full h-8 md:h-12 rounded text-[9px] md:text-xs font-bold text-foreground transition-all border border-border ${selectedBet?.type === CasinoBetType.LOW ? 'ring-2 ring-primary bg-primary/20' : 'bg-transparent hover:bg-muted'
                                        }`}
                                >
                                    1-18
                                </button>
                            </div>
                            <div className="col-span-1">
                                <button
                                    onClick={() => { setSelectedBet({ type: CasinoBetType.EVEN, label: 'EVEN', payout: '1:1' }); setSelectedNumber(null); }}
                                    className={`w-full h-8 md:h-12 rounded text-[9px] md:text-xs font-bold text-foreground transition-all border border-border ${selectedBet?.type === CasinoBetType.EVEN ? 'ring-2 ring-primary bg-primary/20' : 'bg-transparent hover:bg-muted'
                                        }`}
                                >
                                    EVEN
                                </button>
                            </div>
                            <div className="col-span-1">
                                <button
                                    onClick={() => { setSelectedBet({ type: CasinoBetType.RED, label: 'RED', payout: '1:1', color: '#dc2626' }); setSelectedNumber(null); }}
                                    className={`w-full h-8 md:h-12 rounded flex items-center justify-center transition-all border border-white/10 ${selectedBet?.type === CasinoBetType.RED ? 'ring-2 ring-amber-400 scale-105' : 'hover:brightness-110'
                                        } bg-red-600`}
                                >
                                    <div className="w-3 h-3 md:w-4 md:h-4 rotate-45 border border-white/20 bg-red-600" />
                                </button>
                            </div>
                            <div className="col-span-1">
                                <button
                                    onClick={() => { setSelectedBet({ type: CasinoBetType.BLACK, label: 'BLACK', payout: '1:1', color: '#1f2937' }); setSelectedNumber(null); }}
                                    className={`w-full h-8 md:h-12 rounded flex items-center justify-center transition-all border border-white/10 ${selectedBet?.type === CasinoBetType.BLACK ? 'ring-2 ring-amber-400 scale-105' : 'hover:brightness-110'
                                        } bg-gray-900`}
                                >
                                    <div className="w-3 h-3 md:w-4 md:h-4 rotate-45 border border-white/20 bg-gray-900" />
                                </button>
                            </div>
                            <div className="col-span-1">
                                <button
                                    onClick={() => { setSelectedBet({ type: CasinoBetType.ODD, label: 'ODD', payout: '1:1' }); setSelectedNumber(null); }}
                                    className={`w-full h-8 md:h-12 rounded text-[9px] md:text-xs font-bold text-foreground transition-all border border-border ${selectedBet?.type === CasinoBetType.ODD ? 'ring-2 ring-primary bg-primary/20' : 'bg-transparent hover:bg-muted'
                                        }`}
                                >
                                    ODD
                                </button>
                            </div>
                            <div className="col-span-1">
                                <button
                                    onClick={() => { setSelectedBet({ type: CasinoBetType.HIGH, label: '19-36', payout: '1:1' }); setSelectedNumber(null); }}
                                    className={`w-full h-8 md:h-12 rounded text-[9px] md:text-xs font-bold text-foreground transition-all border border-border ${selectedBet?.type === CasinoBetType.HIGH ? 'ring-2 ring-primary bg-primary/20' : 'bg-transparent hover:bg-muted'
                                        }`}
                                >
                                    19-36
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Betting Controls */}
                    <div className="grid grid-cols-2 gap-4 border-t border-border pt-4 mt-4">

                        {/* Left: Bet Info & Potential Win */}
                        <div className="flex flex-col justify-center space-y-1 p-2 bg-muted/50 rounded border border-border">
                            <div className="text-sm font-medium text-foreground">
                                {selectedBet ? (
                                    selectedBet.requiresNumber && selectedNumber !== null ?
                                        `Bet on Number ${selectedNumber}` :
                                        `Bet on ${selectedBet.label}`
                                ) : "Select a bet to start"}
                            </div>

                            <div className="flex justify-between items-center text-xs text-muted-foreground">
                                <span>{selectedBet ? `Pays ${selectedBet.payout}` : "No bet selected"}</span>
                                {balanceData && (
                                    <span className={isInsufficientBalance ? "text-red-400" : ""}>
                                        Bal: {parseFloat(formatUnits(balanceData.value, balanceData.decimals)).toFixed(2)}
                                    </span>
                                )}
                            </div>

                            {selectedBet && betAmount && !isNaN(Number(betAmount)) && (
                                <div className="text-sm text-green-400 font-bold pt-1">
                                    Win: {(Number(betAmount) * (CASINO_PAYOUT_MULTIPLIERS[selectedBet.type] + 1)).toFixed(2)} SEED
                                </div>
                            )}
                        </div>

                        {/* Right: Input */}
                        <div className="space-y-2">
                            <div className="flex justify-between items-center">
                                <label className="text-xs text-muted-foreground font-semibold">Bet Amount</label>
                                {balanceData && (
                                    <button
                                        className="text-[10px] bg-secondary hover:bg-secondary/80 px-1.5 py-0.5 rounded text-secondary-foreground transition-colors"
                                        onClick={() => setBetAmount(formatUnits(balanceData.value, balanceData.decimals))}
                                    >
                                        MAX
                                    </button>
                                )}
                            </div>
                            <div className="flex gap-2">
                                <Input
                                    type="number"
                                    value={betAmount}
                                    onChange={(e) => setBetAmount(e.target.value)}
                                    placeholder="Amount"
                                    className={`w-full text-right font-mono ${isInsufficientBalance ? 'border-red-500 focus-visible:ring-red-500' : ''}`}
                                    min={config ? formatUnits(config.minBet, 18) : '1'}
                                    max={config ? formatUnits(config.maxBet, 18) : '1000'}
                                />
                            </div>
                            {isInsufficientBalance && (
                                <div className="text-[10px] text-red-400 text-right">
                                    Insufficient balance
                                </div>
                            )}
                        </div>
                    </div>

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
                                disabled={(!selectedBet && !pendingGame) || isSpinning || !walletClient || (isInsufficientBalance && !pendingGame)}
                                variant={isInsufficientBalance && !pendingGame ? "destructive" : "default"}
                            >
                                {isSpinning ? (
                                    <>
                                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                        {spinPhase === 'waiting' ? 'Waiting...' : 'Revealing...'}
                                    </>
                                ) : pendingGame ? (
                                    "Resume Spin (Reveal Result)"
                                ) : isInsufficientBalance ? (
                                    "Insufficient Balance"
                                ) : (
                                    `🎲 Spin (${betAmount} SEED)`
                                )}
                            </Button>
                        )}

                        {error && (
                            <p className="text-xs text-destructive text-center">{error}</p>
                        )}

                        {selectedBet && (
                            <p className="text-xs text-center text-muted-foreground">
                                {selectedBet.type === CasinoBetType.STRAIGHT
                                    ? `Bet on Number ${selectedNumber} (${selectedBet.payout})`
                                    : selectedBet.requiresNumber && selectedNumber !== null
                                        ? `Bet on Number ${selectedNumber} (${selectedBet.payout})`
                                        : `Bet on ${selectedBet.label} (${selectedBet.payout})`
                                }
                                {selectedBet.numbers && selectedBet.numbers.length > 1 && (
                                    <span className="block text-[10px] opacity-75">
                                        Covers: {selectedBet.numbers.join(', ')}
                                    </span>
                                )}
                            </p>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
