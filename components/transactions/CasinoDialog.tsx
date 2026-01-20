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

interface PlacedBet {
    id: string;
    type: CasinoBetType;
    label: string;
    numbers: number[];
    amount: string;
    payout: string;
}

const WHEEL_NUMBERS = [
    0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
    5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26
];

export default function CasinoDialog({ open, onOpenChange, landId, onSpinComplete }: CasinoDialogProps) {
    const { data: walletClient } = useWalletClient();
    const publicClient = usePublicClient();
    const { address } = useAccount();

    const [placedBets, setPlacedBets] = useState<PlacedBet[]>([]);
    const [currentBetAmount, setCurrentBetAmount] = useState('10');
    const [isSpinning, setIsSpinning] = useState(false);
    const [spinPhase, setSpinPhase] = useState<'idle' | 'betting' | 'waiting' | 'revealing'>('idle');
    const [result, setResult] = useState<{ number: number; won: boolean; payout: string } | null>(null);
    const [wheelRotation, setWheelRotation] = useState(0);
    const [config, setConfig] = useState<{ minBet: bigint; maxBet: bigint; bettingToken: string; maxBetsPerGame: number } | null>(null);
    const [hasApproval, setHasApproval] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [pendingGame, setPendingGame] = useState<boolean>(false);

    const { data: balanceData } = useBalance({
        address: address,
        token: config?.bettingToken as `0x${string}` || PIXOTCHI_TOKEN_ADDRESS,
        query: { enabled: !!address }
    });

    const totalBetAmount = useMemo(() => {
        return placedBets.reduce((sum, bet) => sum + parseFloat(bet.amount || '0'), 0);
    }, [placedBets]);

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
                    setConfig({ minBet: cfg.minBet, maxBet: cfg.maxBet, bettingToken, maxBetsPerGame: Number(cfg.maxBetsPerGame) || 2 });
                }
                if (landId) {
                    try {
                        const activeGame = await casinoGetActiveBet(landId);
                        if (activeGame && activeGame.isActive) { setPendingGame(true); setSpinPhase('revealing'); }
                    } catch (e) { console.error('Failed to check active game:', e); }
                }
                if (address) {
                    const approval = await checkCasinoApproval(address, bettingToken);
                    setHasApproval(approval > BigInt(0));
                }
            } catch (e) { console.error('Failed to load casino config:', e); }
        };
        if (open) loadConfig();
    }, [open, address, landId]);

    useEffect(() => {
        if (!isSpinning) return;
        const interval = setInterval(() => { setWheelRotation(prev => (prev + 15) % 360); }, 50);
        return () => clearInterval(interval);
    }, [isSpinning]);

    const addBet = useCallback((type: CasinoBetType, label: string, numbers: number[]) => {
        if (!canAddMoreBets) { toast.error(`Maximum ${maxBets} bets per spin`); return; }
        const exists = placedBets.some(b => b.type === type && JSON.stringify([...b.numbers].sort()) === JSON.stringify([...numbers].sort()));
        if (exists) { toast.error('Bet already placed'); return; }
        const newBet: PlacedBet = { id: `${Date.now()}-${Math.random()}`, type, label, numbers, amount: currentBetAmount, payout: `${CASINO_PAYOUT_MULTIPLIERS[type]}:1` };
        setPlacedBets(prev => [...prev, newBet]);
        toast.success(`Added ${label} bet`);
    }, [canAddMoreBets, currentBetAmount, maxBets, placedBets]);

    const removeBet = useCallback((id: string) => { setPlacedBets(prev => prev.filter(b => b.id !== id)); }, []);
    const clearBets = useCallback(() => { setPlacedBets([]); }, []);

    const hasBet = useCallback((type: CasinoBetType, numbers: number[]) => {
        return placedBets.some(b => b.type === type && JSON.stringify([...b.numbers].sort()) === JSON.stringify([...numbers].sort()));
    }, [placedBets]);

    const handleReveal = useCallback(async () => {
        if (!walletClient || !publicClient) return;
        try {
            setSpinPhase('revealing');
            const hash = await casinoReveal(walletClient, landId);
            const receipt = await publicClient.waitForTransactionReceipt({ hash: hash as `0x${string}` });
            let spinResult = null;
            for (const log of receipt.logs) {
                try {
                    const decoded = decodeEventLog({ abi: casinoAbi, data: log.data, topics: log.topics });
                    if (decoded.eventName === 'RouletteSpinResult') { spinResult = decoded.args; break; }
                } catch { continue; }
            }
            if (spinResult) {
                const { winningNumber, won, payout } = spinResult as any;
                setResult({ number: Number(winningNumber), won, payout: formatUnits(payout, 18) });
                const numberIndex = WHEEL_NUMBERS.indexOf(Number(winningNumber));
                setWheelRotation((numberIndex / WHEEL_NUMBERS.length) * 360);
                if (won) toast.success(`🎉 You won ${formatUnits(payout, 18)} SEED!`);
                else toast('Better luck next time!', { icon: '🎲' });
            } else { setError('Could not verify result'); }
            setPendingGame(false); setPlacedBets([]); onSpinComplete?.();
        } catch (err: any) { console.error('Reveal failed:', err); setError(err.message || 'Reveal failed'); toast.error('Reveal failed'); }
        finally { setIsSpinning(false); setSpinPhase('idle'); }
    }, [walletClient, publicClient, landId, onSpinComplete]);

    const handleSpin = useCallback(async () => {
        if (!walletClient || !publicClient || placedBets.length === 0) return;
        setError(null); setIsSpinning(true); setResult(null); setSpinPhase('betting');
        try {
            const betTypes = placedBets.map(b => b.type);
            const betNumbersArray = placedBets.map(b => b.numbers);
            const betAmounts = placedBets.map(b => parseUnits(b.amount, 18));
            await casinoPlaceBets(walletClient, landId, betTypes, betNumbersArray, betAmounts);
            toast.success('Bets placed! Waiting for block...');
            setSpinPhase('waiting');
            await new Promise(resolve => setTimeout(resolve, 5000));
            await handleReveal();
        } catch (err: any) { console.error('Spin failed:', err); setError(err.message || 'Spin failed'); toast.error('Spin failed'); setIsSpinning(false); setSpinPhase('idle'); }
    }, [walletClient, publicClient, placedBets, landId, handleReveal]);

    const refreshApproval = useCallback(async () => {
        if (address) { const approval = await checkCasinoApproval(address, config?.bettingToken || PIXOTCHI_TOKEN_ADDRESS); setHasApproval(approval > BigInt(0)); }
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

        // Corner numbers (4 adjacent)
        const cornerNums = isTop ? [] : [num, numAbove, numRight, numRight + (numAbove - num)];

        // Six-line (6 numbers - two streets)
        const sixLineNums = [...streetNums, streetBase + 3, streetBase + 4, streetBase + 5];

        return (
            <div key={num} className="relative">
                {/* Main number button */}
                <button
                    onClick={() => addBet(CasinoBetType.STRAIGHT, `${num}`, [num])}
                    className={`w-full h-10 md:h-14 flex items-center justify-center rounded text-[10px] md:text-sm font-bold text-white transition-all border border-white/10 
                        ${hasBet(CasinoBetType.STRAIGHT, [num]) ? 'ring-2 ring-amber-400 z-20' : 'hover:brightness-110'}
                        ${isRed ? 'bg-red-600' : 'bg-gray-900'}`}
                >
                    {num}
                </button>

                {/* Street bet hitbox - above top row numbers */}
                {isTop && (
                    <div
                        className="absolute -top-3 left-1/2 -translate-x-1/2 w-10 h-6 cursor-pointer z-20 flex items-center justify-center group"
                        onClick={(e) => { e.stopPropagation(); addBet(CasinoBetType.STREET, `Street ${streetNums[0]}-${streetNums[2]}`, streetNums); }}
                    >
                        <div className={`w-8 h-2 rounded transition-all ${hasBet(CasinoBetType.STREET, streetNums) ? 'bg-purple-500 ring-2 ring-white' : 'group-hover:bg-purple-400/70'}`} />
                    </div>
                )}

                {/* Horizontal split hitbox - between this row and row below */}
                {!isBottom && (
                    <div
                        className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-8 h-4 cursor-pointer z-20 flex items-center justify-center group"
                        onClick={(e) => { e.stopPropagation(); addBet(CasinoBetType.SPLIT, `Split ${numBelow}-${num}`, [numBelow, num]); }}
                    >
                        <div className={`w-4 h-4 rounded-full transition-all ${hasBet(CasinoBetType.SPLIT, [numBelow, num]) ? 'bg-amber-400 ring-2 ring-white' : 'group-hover:bg-white/60'}`} />
                    </div>
                )}

                {/* Vertical split hitbox - between this column and next column */}
                {!isLastCol && (
                    <div
                        className="absolute top-1/2 -right-2 -translate-y-1/2 w-4 h-8 cursor-pointer z-20 flex items-center justify-center group"
                        onClick={(e) => { e.stopPropagation(); addBet(CasinoBetType.SPLIT, `Split ${num}-${numRight}`, [num, numRight]); }}
                    >
                        <div className={`w-3 h-3 rounded-full transition-all ${hasBet(CasinoBetType.SPLIT, [num, numRight]) ? 'bg-amber-400 ring-2 ring-white' : 'group-hover:bg-white/60'}`} />
                    </div>
                )}

                {/* Corner hitbox - at intersection of 4 numbers */}
                {!isBottom && !isLastCol && (
                    <div
                        className="absolute -bottom-2 -right-2 w-5 h-5 cursor-pointer z-30 flex items-center justify-center group"
                        onClick={(e) => {
                            e.stopPropagation();
                            const cornerSet = [numBelow, num, numBelow + 3, numRight];
                            addBet(CasinoBetType.CORNER, `Corner ${cornerSet.join(',')}`, cornerSet);
                        }}
                    >
                        <div className={`w-3 h-3 rounded-full transition-all ${hasBet(CasinoBetType.CORNER, [numBelow, num, numBelow + 3, numRight]) ? 'bg-blue-400 ring-2 ring-white' : 'group-hover:bg-blue-400/70'}`} />
                    </div>
                )}

                {/* Six-line hitbox - at top between two streets */}
                {isTop && !isLastCol && (
                    <div
                        className="absolute -top-3 -right-2 w-5 h-5 cursor-pointer z-30 flex items-center justify-center group"
                        onClick={(e) => { e.stopPropagation(); addBet(CasinoBetType.SIX_LINE, `6-Line ${streetNums[0]}-${streetNums[2] + 3}`, sixLineNums); }}
                    >
                        <div className={`w-3 h-3 rounded-full transition-all ${hasBet(CasinoBetType.SIX_LINE, sixLineNums) ? 'bg-orange-400 ring-2 ring-white' : 'group-hover:bg-orange-400/70'}`} />
                    </div>
                )}
            </div>
        );
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="font-pixel text-xl flex items-center gap-2">
                        🎰 European Roulette
                        <span className="text-xs font-normal text-muted-foreground ml-2">(Max {maxBets} bets)</span>
                    </DialogTitle>
                </DialogHeader>

                <div className="space-y-4 relative">
                    {/* Roulette Wheel */}
                    <div className="flex justify-center">
                        <div className="relative w-40 h-40">
                            <div className="w-full h-full rounded-full border-4 border-amber-600 shadow-lg overflow-hidden"
                                style={{
                                    transform: `rotate(${wheelRotation}deg)`, transition: isSpinning ? 'none' : 'transform 0.5s ease-out',
                                    background: 'conic-gradient(from 0deg, #dc2626 0deg 9.73deg, #1f2937 9.73deg 19.46deg, #dc2626 19.46deg 29.19deg, #1f2937 29.19deg 38.92deg, #dc2626 38.92deg 48.65deg, #1f2937 48.65deg 58.38deg, #16a34a 58.38deg 68.11deg, #dc2626 68.11deg 77.84deg, #1f2937 77.84deg 87.57deg, #dc2626 87.57deg 97.3deg, #1f2937 97.3deg 107.03deg, #dc2626 107.03deg 116.76deg, #1f2937 116.76deg 126.49deg, #dc2626 126.49deg 136.22deg, #1f2937 136.22deg 145.95deg, #dc2626 145.95deg 155.68deg, #1f2937 155.68deg 165.41deg, #dc2626 165.41deg 175.14deg, #1f2937 175.14deg 184.87deg, #dc2626 184.87deg 194.6deg, #1f2937 194.6deg 204.33deg, #dc2626 204.33deg 214.06deg, #1f2937 214.06deg 223.79deg, #dc2626 223.79deg 233.52deg, #1f2937 233.52deg 243.25deg, #dc2626 243.25deg 252.98deg, #1f2937 252.98deg 262.71deg, #dc2626 262.71deg 272.44deg, #1f2937 272.44deg 282.17deg, #dc2626 282.17deg 291.9deg, #1f2937 291.9deg 301.63deg, #dc2626 301.63deg 311.36deg, #1f2937 311.36deg 321.09deg, #dc2626 321.09deg 330.82deg, #1f2937 330.82deg 340.55deg, #dc2626 340.55deg 350.28deg, #1f2937 350.28deg 360deg)'
                                }}>
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <div className="w-12 h-12 rounded-full bg-amber-700 border-2 border-amber-500 flex items-center justify-center">
                                        <span className="text-white font-bold text-[10px]">SPIN</span>
                                    </div>
                                </div>
                            </div>
                            <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1">
                                <div className="w-3 h-3 bg-white rounded-full border border-gray-400 shadow-md" />
                            </div>
                            {result && (
                                <div className="absolute -bottom-6 left-1/2 -translate-x-1/2">
                                    <div className={`px-3 py-1 rounded-full text-white font-bold text-sm ${getNumberColor(result.number)}`}>{result.number}</div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Spin Status */}
                    {isSpinning && (
                        <div className="text-center text-sm text-muted-foreground">
                            <Loader2 className="inline h-4 w-4 animate-spin mr-2" />
                            {spinPhase === 'betting' && 'Placing bets...'}{spinPhase === 'waiting' && 'Waiting for block...'}{spinPhase === 'revealing' && 'Revealing...'}
                        </div>
                    )}

                    {/* Result */}
                    {result && !isSpinning && (
                        <div className={`text-center p-2 rounded-lg text-sm ${result.won ? 'bg-primary/10 text-primary border border-primary/20' : 'bg-muted text-muted-foreground border border-border'}`}>
                            <span className="font-bold">{result.won ? `🎉 Won ${parseFloat(result.payout).toFixed(2)} SEED!` : 'No win'}</span>
                        </div>
                    )}

                    {/* Bets Panel */}
                    <div className="bg-muted/30 rounded-lg p-2 border border-border">
                        <div className="flex justify-between items-center mb-1">
                            <span className="text-xs font-semibold">Your Bets ({placedBets.length}/{maxBets})</span>
                            {placedBets.length > 0 && <Button variant="ghost" size="sm" onClick={clearBets} className="h-5 text-[10px] px-1"><Trash2 className="h-3 w-3 mr-1" />Clear</Button>}
                        </div>
                        {placedBets.length === 0 ? (
                            <p className="text-[10px] text-muted-foreground text-center py-1">Click on table to add bets</p>
                        ) : (
                            <div className="flex flex-wrap gap-1">
                                {placedBets.map(bet => (
                                    <div key={bet.id} className="flex items-center gap-1 bg-background rounded px-1.5 py-0.5 text-[10px] border border-border">
                                        <span className="font-medium">{bet.label}</span>
                                        <span className="text-muted-foreground">({bet.amount})</span>
                                        <button onClick={() => removeBet(bet.id)} className="hover:text-destructive"><X className="h-2.5 w-2.5" /></button>
                                    </div>
                                ))}
                            </div>
                        )}
                        {placedBets.length > 0 && (
                            <div className="flex justify-between mt-1 pt-1 border-t border-border text-xs">
                                <span>Total: <strong>{totalBetAmount.toFixed(2)}</strong></span>
                                <span className="text-green-500">Max Win: <strong>{bestPossibleWin.toFixed(2)}</strong></span>
                            </div>
                        )}
                    </div>

                    {/* Bet Amount */}
                    <div className="flex items-center gap-2">
                        <label className="text-xs text-muted-foreground">Bet:</label>
                        <Input type="number" value={currentBetAmount} onChange={(e) => setCurrentBetAmount(e.target.value)} className="w-16 h-7 text-xs" min="1" />
                        <span className="text-xs text-muted-foreground">SEED</span>
                        {balanceData && <span className={`text-xs ml-auto ${isInsufficientBalance ? 'text-red-400' : 'text-muted-foreground'}`}>Bal: {parseFloat(formatUnits(balanceData.value, balanceData.decimals)).toFixed(2)}</span>}
                    </div>

                    {/* BETTING TABLE */}
                    <div className="select-none w-full">
                        <div className="grid grid-cols-[28px_repeat(12,1fr)_28px] md:grid-cols-[36px_repeat(12,1fr)_36px] gap-1 md:gap-1.5">
                            {/* Zero */}
                            <button
                                onClick={() => addBet(CasinoBetType.STRAIGHT, '0', [0])}
                                className={`row-span-3 flex items-center justify-center rounded text-xs font-bold text-white bg-green-600 border border-white/10 
                                    ${hasBet(CasinoBetType.STRAIGHT, [0]) ? 'ring-2 ring-amber-400' : 'hover:brightness-110'}`}
                            ><span className="-rotate-90">0</span></button>

                            {/* Row 3 (Top): 3, 6, 9... 36 */}
                            {[...Array(12)].map((_, i) => renderNumberCell((i * 3) + 3, 0, i))}

                            {/* 2to1 Column 3 */}
                            <button onClick={() => addBet(CasinoBetType.COLUMN, '3rd Col', [3])}
                                className={`h-10 md:h-14 flex items-center justify-center rounded text-[8px] font-bold border border-border 
                                    ${hasBet(CasinoBetType.COLUMN, [3]) ? 'ring-2 ring-primary bg-primary/20' : 'hover:bg-muted'}`}>
                                <span className="-rotate-90">2:1</span>
                            </button>

                            {/* Row 2 (Mid): 2, 5, 8... 35 */}
                            {[...Array(12)].map((_, i) => renderNumberCell((i * 3) + 2, 1, i))}

                            {/* 2to1 Column 2 */}
                            <button onClick={() => addBet(CasinoBetType.COLUMN, '2nd Col', [2])}
                                className={`h-10 md:h-14 flex items-center justify-center rounded text-[8px] font-bold border border-border 
                                    ${hasBet(CasinoBetType.COLUMN, [2]) ? 'ring-2 ring-primary bg-primary/20' : 'hover:bg-muted'}`}>
                                <span className="-rotate-90">2:1</span>
                            </button>

                            {/* Row 1 (Bottom): 1, 4, 7... 34 */}
                            {[...Array(12)].map((_, i) => renderNumberCell((i * 3) + 1, 2, i))}

                            {/* 2to1 Column 1 */}
                            <button onClick={() => addBet(CasinoBetType.COLUMN, '1st Col', [1])}
                                className={`h-10 md:h-14 flex items-center justify-center rounded text-[8px] font-bold border border-border 
                                    ${hasBet(CasinoBetType.COLUMN, [1]) ? 'ring-2 ring-primary bg-primary/20' : 'hover:bg-muted'}`}>
                                <span className="-rotate-90">2:1</span>
                            </button>
                        </div>

                        {/* Dozens */}
                        <div className="grid grid-cols-[28px_repeat(3,1fr)_28px] md:grid-cols-[36px_repeat(3,1fr)_36px] gap-1 mt-1">
                            <div />
                            <button onClick={() => addBet(CasinoBetType.DOZEN, '1st 12', [1])} className={`py-1.5 rounded text-[10px] font-bold border border-border ${hasBet(CasinoBetType.DOZEN, [1]) ? 'ring-2 ring-primary bg-primary/20' : 'hover:bg-muted'}`}>1st 12</button>
                            <button onClick={() => addBet(CasinoBetType.DOZEN, '2nd 12', [2])} className={`py-1.5 rounded text-[10px] font-bold border border-border ${hasBet(CasinoBetType.DOZEN, [2]) ? 'ring-2 ring-primary bg-primary/20' : 'hover:bg-muted'}`}>2nd 12</button>
                            <button onClick={() => addBet(CasinoBetType.DOZEN, '3rd 12', [3])} className={`py-1.5 rounded text-[10px] font-bold border border-border ${hasBet(CasinoBetType.DOZEN, [3]) ? 'ring-2 ring-primary bg-primary/20' : 'hover:bg-muted'}`}>3rd 12</button>
                            <div />
                        </div>

                        {/* Outside Bets */}
                        <div className="grid grid-cols-[28px_repeat(6,1fr)_28px] md:grid-cols-[36px_repeat(6,1fr)_36px] gap-1 mt-1">
                            <div />
                            <button onClick={() => addBet(CasinoBetType.LOW, '1-18', [])} className={`py-1.5 rounded text-[9px] font-bold border border-border ${hasBet(CasinoBetType.LOW, []) ? 'ring-2 ring-primary bg-primary/20' : 'hover:bg-muted'}`}>1-18</button>
                            <button onClick={() => addBet(CasinoBetType.EVEN, 'EVEN', [])} className={`py-1.5 rounded text-[9px] font-bold border border-border ${hasBet(CasinoBetType.EVEN, []) ? 'ring-2 ring-primary bg-primary/20' : 'hover:bg-muted'}`}>EVEN</button>
                            <button onClick={() => addBet(CasinoBetType.RED, 'RED', [])} className={`py-1.5 rounded text-[9px] font-bold text-white bg-red-600 border border-white/10 ${hasBet(CasinoBetType.RED, []) ? 'ring-2 ring-amber-400' : 'hover:brightness-110'}`}>RED</button>
                            <button onClick={() => addBet(CasinoBetType.BLACK, 'BLACK', [])} className={`py-1.5 rounded text-[9px] font-bold text-white bg-gray-900 border border-white/10 ${hasBet(CasinoBetType.BLACK, []) ? 'ring-2 ring-amber-400' : 'hover:brightness-110'}`}>BLACK</button>
                            <button onClick={() => addBet(CasinoBetType.ODD, 'ODD', [])} className={`py-1.5 rounded text-[9px] font-bold border border-border ${hasBet(CasinoBetType.ODD, []) ? 'ring-2 ring-primary bg-primary/20' : 'hover:bg-muted'}`}>ODD</button>
                            <button onClick={() => addBet(CasinoBetType.HIGH, '19-36', [])} className={`py-1.5 rounded text-[9px] font-bold border border-border ${hasBet(CasinoBetType.HIGH, []) ? 'ring-2 ring-primary bg-primary/20' : 'hover:bg-muted'}`}>19-36</button>
                            <div />
                        </div>
                    </div>

                    {/* Bet Legend */}
                    <div className="flex flex-wrap gap-2 text-[9px] text-muted-foreground justify-center">
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-400" />Street</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-white/60" />Split</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400" />Corner</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-400" />6-Line</span>
                    </div>

                    {/* Action */}
                    <div className="space-y-2">
                        {!hasApproval ? (
                            <ApproveTransaction spenderAddress={LAND_CONTRACT_ADDRESS} tokenAddress={(config?.bettingToken || PIXOTCHI_TOKEN_ADDRESS) as `0x${string}`} onSuccess={refreshApproval} buttonText="Approve Betting Token" buttonClassName="w-full" />
                        ) : (
                            <Button className="w-full" onClick={pendingGame ? handleReveal : handleSpin}
                                disabled={(placedBets.length === 0 && !pendingGame) || isSpinning || !walletClient || (isInsufficientBalance && !pendingGame)}
                                variant={isInsufficientBalance && !pendingGame ? "destructive" : "default"}>
                                {isSpinning ? (<><Loader2 className="h-4 w-4 animate-spin mr-2" />{spinPhase === 'betting' && 'Placing...'}{spinPhase === 'waiting' && 'Waiting...'}{spinPhase === 'revealing' && 'Revealing...'}</>)
                                    : pendingGame ? "Resume (Reveal)" : isInsufficientBalance ? "Insufficient Balance" : placedBets.length === 0 ? "Select bets" : `🎲 Spin (${totalBetAmount.toFixed(2)} SEED)`}
                            </Button>
                        )}
                        {error && <p className="text-xs text-destructive text-center">{error}</p>}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
