'use client';

import { useState } from 'react';
import Image from 'next/image';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SWAP_TOKEN_MAP } from '@/lib/swap/constants';
import type { UserSwapTokenId } from '@/lib/swap/types';
import { cn } from '@/lib/utils';
import { SWAP_PANEL_STRINGS as S } from '@/components/tabs/pixotchi-swap-panel.strings';

const OCK_COMPAT_FONT = 'ock-compat-font';
const SWAP_TOKEN_TRIGGER_CLASS =
  'flex min-h-11 min-w-[5.75rem] shrink-0 items-center gap-2 rounded-[var(--radius-control)] border border-border/60 bg-card/95 bg-[image:var(--gradient-surface)] px-3 py-2 shadow-[var(--shadow-control)] hover:border-primary/35 hover:bg-[hsl(var(--nav-hover-bg))] active:bg-secondary focus:bg-secondary disabled:pointer-events-none disabled:opacity-[0.38] max-[360px]:min-w-[5.15rem] max-[360px]:gap-1.5 max-[360px]:px-2 max-[340px]:min-w-[4.75rem] max-[340px]:gap-1 max-[340px]:px-1.5';

export function SwapTokenSelector({
  value,
  options,
  onSelect,
  disabled,
  className,
}: {
  value: UserSwapTokenId;
  options: readonly UserSwapTokenId[];
  onSelect: (next: UserSwapTokenId) => void;
  disabled?: boolean;
  className?: string;
}) {
  const token = SWAP_TOKEN_MAP[value];
  const [isOpen, setIsOpen] = useState(false);

  return (
    // Keep the swap form accessible while choosing a token; modal menus can hide
    // the focused trigger before focus has moved into the menu.
    <DropdownMenu modal={false} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="ockTokenSelectButton_Button"
          className={cn(
            SWAP_TOKEN_TRIGGER_CLASS,
            className,
          )}
          disabled={disabled}
          aria-label={S.aria.selectToken(token.displaySymbol)}
          aria-haspopup="menu"
          aria-expanded={isOpen}
        >
          <Image
            src={token.image}
            alt=""
            width={20}
            height={20}
            aria-hidden="true"
            className="h-5 w-5 shrink-0 overflow-hidden rounded-full object-contain max-[340px]:h-4 max-[340px]:w-4"
          />
          <span
            className={cn(OCK_COMPAT_FONT, 'whitespace-nowrap font-semibold text-foreground max-[340px]:text-xs')}
            data-testid="ockTokenSelectButton_Symbol"
          >
            {token.displaySymbol}
          </span>
          {/* Single chevron-down SVG; rotate 180 degrees when the menu is open so
              the glyph transitions smoothly instead of swapping shapes. */}
          <svg
            role="img"
            aria-hidden="true"
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={cn(
              'h-4 w-4 shrink-0 transition-transform duration-150 max-[340px]:h-3.5 max-[340px]:w-3.5',
              isOpen && 'rotate-180',
            )}
            >
              <path
                d="M12.95 4.86L8 9.81L3.05 4.86L1.64 6.28L8 12.64L14.36 6.28L12.95 4.86Z"
              className="fill-foreground"
              />
            </svg>
          </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={6}
        collisionPadding={12}
        className="w-max min-w-[8rem] max-w-[calc(100vw-2rem)] rounded-[var(--radius-panel)] p-1"
      >
        <DropdownMenuRadioGroup value={value} onValueChange={(next) => onSelect(next as UserSwapTokenId)}>
        {options.map((option) => {
          const optionToken = SWAP_TOKEN_MAP[option];
          return (
            <DropdownMenuRadioItem
              key={option}
              value={option}
              indicatorPosition="end"
              className="cursor-pointer rounded-[var(--radius-control)] pl-2 pr-8 py-2.5"
            >
              <span className="flex items-center gap-2 whitespace-nowrap">
                <Image
                  src={optionToken.image}
                  alt=""
                  width={20}
                  height={20}
                  aria-hidden="true"
                  className="h-5 w-5 shrink-0 rounded-full object-contain"
                />
                <span>{optionToken.displaySymbol}</span>
              </span>
            </DropdownMenuRadioItem>
          );
        })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
