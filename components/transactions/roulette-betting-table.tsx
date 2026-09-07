"use client";
import { CasinoBetType, RED_NUMBERS } from '@/public/abi/casino-abi';
import { getRouletteTableTargets } from '@/lib/roulette-bet-options';
import { cn } from '@/lib/utils';
const TABLE_TARGETS = getRouletteTableTargets();
const ROULETTE_NUMBER_BUTTON_CLASS =
    "flex h-12 w-full items-center justify-center rounded-sm border border-white/10 text-xs font-bold text-white transition-[background-color,border-color,color,filter,box-shadow] duration-[var(--motion-quick)] ease-[var(--ease-standard)] md:h-14 md:text-sm";
const ROULETTE_COLUMN_BUTTON_CLASS =
    "flex h-full w-full items-center justify-center rounded-r-sm border border-white/20 bg-black/40 text-xs font-bold text-white [@media(hover:hover)_and_(pointer:fine)]:hover:bg-black/60";
const ROULETTE_OUTSIDE_BUTTON_CLASS =
    "flex h-11 min-h-11 items-center justify-center rounded-sm border border-white/20 bg-black/40 px-1 text-xs font-bold text-white [@media(hover:hover)_and_(pointer:fine)]:hover:bg-black/60";
const ROULETTE_SELECTED_AREA_CLASS = "ring-2 inset-1 ring-primary bg-primary/40";

export interface RouletteBettingTableProps {
  bettingInputDisabled: boolean;
  addBet: (type: CasinoBetType, label: string, numbers: number[]) => void;
  hasBet: (type: CasinoBetType, numbers: number[]) => boolean;
}
export const getRouletteNumberColor = (n: number): string => n === 0 ? 'bg-green-600' : RED_NUMBERS.includes(n) ? 'bg-red-600' : 'bg-gray-900';
export function RouletteBettingTable({ bettingInputDisabled, addBet, hasBet }: RouletteBettingTableProps) {
    const getNumberColor = getRouletteNumberColor;

    const renderNumberCell = (num: number) => (
      <div key={num} className="relative h-12 min-w-0 md:h-14">
        <button type="button" onClick={() => addBet(CasinoBetType.STRAIGHT, String(num), [num])}
            disabled={bettingInputDisabled} aria-label={`Bet straight on ${num}`}
            className={`${ROULETTE_NUMBER_BUTTON_CLASS} ${getNumberColor(num)} ${hasBet(CasinoBetType.STRAIGHT, [num]) ? 'ring-2 ring-inset ring-amber-400' : ''}`}>
            {num}
        </button>
        {TABLE_TARGETS.filter(target => target.anchor === num).map(target => {
          const selected = hasBet(target.type, target.numbers);
          return <button key={`${target.type}-${target.numbers.join('-')}`} type="button"
            disabled={bettingInputDisabled} aria-label={target.label} title={target.label} aria-pressed={selected}
            data-roulette-combination={target.position}
            onClick={() => addBet(target.type, target.label, target.numbers)}
            className={cn(
              // 16px boundary bands share the existing 2px gutters. Their ends
              // stop before junction targets, leaving number centers untouched.
              'group absolute z-10 flex items-center justify-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-200 disabled:cursor-not-allowed disabled:opacity-40 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-amber-300/25',
              target.position === 'right' && cn('-right-[9px] bottom-2 w-4', num % 3 === 0 ? 'top-4' : 'top-2'),
              target.position === 'bottom' && '-bottom-[9px] left-2 right-2 h-4',
              target.position === 'corner' && '-bottom-[9px] -right-[9px] z-20 h-4 w-4',
              target.position === 'top' && 'left-2 right-2 top-0 h-4',
              target.position === 'top-corner' && '-right-[9px] top-0 z-20 h-4 w-4',
              selected && 'bg-amber-400/25',
            )}>
            <span aria-hidden="true" className={cn(
              'pointer-events-none rounded-full',
              target.position === 'right' ? 'h-3 w-0.5' : target.position === 'bottom' || target.position === 'top' ? 'h-0.5 w-3' : 'h-1.5 w-1.5',
              selected ? 'bg-amber-300 ring-1 ring-amber-100' : 'bg-white/35 group-focus-visible:bg-amber-200 [@media(hover:hover)_and_(pointer:fine)]:group-hover:bg-amber-200',
            )} />
          </button>;
        })}
      </div>
    );


  return <>                    {/* BETTING TABLE - Fully Responsive Fit */}
                    <div className="w-full select-none overflow-x-auto overscroll-x-contain pb-4 [scrollbar-width:thin]" role="group" aria-label="Roulette betting table">
                        <div className="mx-auto min-w-[660px] max-w-[820px] md:min-w-0">
                            {/* Numbers Grid */}
                            <div className="grid w-full grid-cols-[44px_repeat(12,minmax(44px,1fr))_44px] gap-[2px] rounded-lg bg-border p-[1px] md:grid-cols-[48px_repeat(12,minmax(44px,1fr))_48px]">
                                {/* Zero - Spans 3 rows */}
                                <div className="row-span-3 h-full relative">
                                    <button
                                        type="button"
                                        onClick={() => addBet(CasinoBetType.STRAIGHT, '0', [0])}
                                        disabled={bettingInputDisabled}
                                        aria-label="Bet straight on 0"
                                        className={`flex h-full w-full items-center justify-center rounded-l-md border border-white/10 bg-green-600 text-xs font-bold text-white md:text-sm
                                            ${hasBet(CasinoBetType.STRAIGHT, [0]) ? 'ring-2 inset-2 ring-amber-400 z-10' : '[@media(hover:hover)_and_(pointer:fine)]:hover:brightness-110'}`}
                                    ><span className="-rotate-90">0</span></button>

                                </div>

                                {/* Row 3 (Top): 3, 6, 9... 36 */}
                                {[...Array(12)].map((_, i) => renderNumberCell((i * 3) + 3))}

                                {/* 2to1 Column 3 */}
                                <button type="button" onClick={() => addBet(CasinoBetType.COLUMN, '3rd Col', [3])} disabled={bettingInputDisabled}
                                    aria-label="Bet third column"
                                    className={`${ROULETTE_COLUMN_BUTTON_CLASS}
                                        ${hasBet(CasinoBetType.COLUMN, [3]) ? ROULETTE_SELECTED_AREA_CLASS : ''}`}>
                                    <span className="-rotate-90">2:1</span>
                                </button>

                                {/* Row 2 (Mid): 2, 5, 8... 35 */}
                                {[...Array(12)].map((_, i) => renderNumberCell((i * 3) + 2))}

                                {/* 2to1 Column 2 */}
                                <button type="button" onClick={() => addBet(CasinoBetType.COLUMN, '2nd Col', [2])} disabled={bettingInputDisabled}
                                    aria-label="Bet second column"
                                    className={`${ROULETTE_COLUMN_BUTTON_CLASS}
                                        ${hasBet(CasinoBetType.COLUMN, [2]) ? ROULETTE_SELECTED_AREA_CLASS : ''}`}>
                                    <span className="-rotate-90">2:1</span>
                                </button>

                                {/* Row 1 (Bottom): 1, 4, 7... 34 */}
                                {[...Array(12)].map((_, i) => renderNumberCell((i * 3) + 1))}

                                {/* 2to1 Column 1 */}
                                <button type="button" onClick={() => addBet(CasinoBetType.COLUMN, '1st Col', [1])} disabled={bettingInputDisabled}
                                    aria-label="Bet first column"
                                    className={`${ROULETTE_COLUMN_BUTTON_CLASS}
                                        ${hasBet(CasinoBetType.COLUMN, [1]) ? ROULETTE_SELECTED_AREA_CLASS : ''}`}>
                                    <span className="-rotate-90">2:1</span>
                                </button>
                            </div>

                            {/* Dozens */}
                            <div className="mt-[2px] grid w-full grid-cols-[44px_repeat(3,1fr)_44px] gap-[2px] md:grid-cols-[48px_repeat(3,1fr)_48px]">
                                <div />
                                <button type="button" onClick={() => addBet(CasinoBetType.DOZEN, '1st 12', [1])} disabled={bettingInputDisabled} aria-label="Bet first twelve" className={`${ROULETTE_OUTSIDE_BUTTON_CLASS} ${hasBet(CasinoBetType.DOZEN, [1]) ? ROULETTE_SELECTED_AREA_CLASS : ''}`}>1st 12</button>
                                <button type="button" onClick={() => addBet(CasinoBetType.DOZEN, '2nd 12', [2])} disabled={bettingInputDisabled} aria-label="Bet second twelve" className={`${ROULETTE_OUTSIDE_BUTTON_CLASS} ${hasBet(CasinoBetType.DOZEN, [2]) ? ROULETTE_SELECTED_AREA_CLASS : ''}`}>2nd 12</button>
                                <button type="button" onClick={() => addBet(CasinoBetType.DOZEN, '3rd 12', [3])} disabled={bettingInputDisabled} aria-label="Bet third twelve" className={`${ROULETTE_OUTSIDE_BUTTON_CLASS} ${hasBet(CasinoBetType.DOZEN, [3]) ? ROULETTE_SELECTED_AREA_CLASS : ''}`}>3rd 12</button>
                                <div />
                            </div>

                            {/* Outside Bets */}
                            <div className="mt-[2px] grid w-full grid-cols-[44px_repeat(6,1fr)_44px] gap-[2px] md:grid-cols-[48px_repeat(6,1fr)_48px]">
                                <div />
                                <button type="button" onClick={() => addBet(CasinoBetType.LOW, '1-18', [])} disabled={bettingInputDisabled} aria-label="Bet one to eighteen" className={`${ROULETTE_OUTSIDE_BUTTON_CLASS} ${hasBet(CasinoBetType.LOW, []) ? ROULETTE_SELECTED_AREA_CLASS : ''}`}>1-18</button>
                                <button type="button" onClick={() => addBet(CasinoBetType.EVEN, 'EVEN', [])} disabled={bettingInputDisabled} aria-label="Bet even numbers" className={`${ROULETTE_OUTSIDE_BUTTON_CLASS} ${hasBet(CasinoBetType.EVEN, []) ? ROULETTE_SELECTED_AREA_CLASS : ''}`}>EVEN</button>
                                <button type="button" onClick={() => addBet(CasinoBetType.RED, 'RED', [])} disabled={bettingInputDisabled} aria-label="Bet red numbers" className={`flex h-11 min-h-11 items-center justify-center rounded-sm border border-white/10 bg-red-600 px-1 text-xs font-bold text-white ${hasBet(CasinoBetType.RED, []) ? 'ring-2 inset-1 ring-amber-400' : '[@media(hover:hover)_and_(pointer:fine)]:hover:brightness-110'}`}>RED</button>
                                <button type="button" onClick={() => addBet(CasinoBetType.BLACK, 'BLACK', [])} disabled={bettingInputDisabled} aria-label="Bet black numbers" className={`flex h-11 min-h-11 items-center justify-center rounded-sm border border-white/10 bg-gray-900 px-1 text-xs font-bold text-white ${hasBet(CasinoBetType.BLACK, []) ? 'ring-2 inset-1 ring-amber-400' : '[@media(hover:hover)_and_(pointer:fine)]:hover:brightness-110'}`}>BLACK</button>
                                <button type="button" onClick={() => addBet(CasinoBetType.ODD, 'ODD', [])} disabled={bettingInputDisabled} aria-label="Bet odd numbers" className={`${ROULETTE_OUTSIDE_BUTTON_CLASS} ${hasBet(CasinoBetType.ODD, []) ? ROULETTE_SELECTED_AREA_CLASS : ''}`}>ODD</button>
                                <button type="button" onClick={() => addBet(CasinoBetType.HIGH, '19-36', [])} disabled={bettingInputDisabled} aria-label="Bet nineteen to thirty-six" className={`${ROULETTE_OUTSIDE_BUTTON_CLASS} ${hasBet(CasinoBetType.HIGH, []) ? ROULETTE_SELECTED_AREA_CLASS : ''}`}>19-36</button>
                                <div />
                            </div>
                        </div>
                    </div>

                    <p className="text-center text-xs text-white/65">Edges: split · Intersections: corner · Top edge: street / six line</p></>;
}
