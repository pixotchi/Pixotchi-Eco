import Image from 'next/image';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const resourceIcons = {
  seed: '/PixotchiKit/COIN.svg',
  eth: '/icons/ethlogo.svg',
  sol: '/icons/solana.svg',
  pixotchi: '/icons/cc.png',
  points: '/icons/pts.svg',
  lifetime: '/icons/tod.svg',
  protection: '/icons/Shield.png',
} as const;

/** Decorative resource artwork supplements the visible amount and unit. */
export function ResourceValue({ resource, children, className }: {
  resource: keyof typeof resourceIcons;
  children: ReactNode;
  className?: string;
}) {
  return <span className={cn('inline-flex max-w-full min-w-0 items-center gap-1 align-middle', className)}>
    <Image src={resourceIcons[resource]} alt="" aria-hidden="true" width={14} height={14} className="h-3.5 w-3.5 shrink-0 object-contain" />
    <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
  </span>;
}
