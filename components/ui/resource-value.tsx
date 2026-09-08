import Image from 'next/image';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const resourceIcons = {
  seed: '/PixotchiKit/COIN.svg',
  leaf: '/icons/leaf.png',
  eth: '/icons/ethlogo.svg',
  sol: '/icons/solana.svg',
  pixotchi: '/icons/cc.png',
  points: '/icons/pts.svg',
  lifetime: '/icons/tod.svg',
  protection: '/icons/Shield.png',
  duration: '/icons/duration-clock.png',
  stars: '/icons/Star.svg',
  jesse: '/icons/jessetoken.png',
  usdc: '/icons/usdc.svg',
  poet: '/icons/poet.png',
} as const;

const unitResources: Record<string, keyof typeof resourceIcons> = {
  SEED: 'seed', LEAF: 'leaf', ETH: 'eth', SOL: 'sol', WSOL: 'sol',
  PIXOTCHI: 'pixotchi', PTS: 'points', XP: 'points',
  LIFETIME: 'lifetime', MINUTES: 'lifetime', TOD: 'lifetime',
  JESSE: 'jesse', '$JESSE': 'jesse', USDC: 'usdc', POET: 'poet',
};

/** Decorative resource artwork supplements the visible amount and unit. */
export function ResourceValue({ resource, unit, children, className }: {
  resource?: keyof typeof resourceIcons;
  unit?: string;
  children: ReactNode;
  className?: string;
}) {
  const resolvedResource = resource ?? unitResources[unit?.trim().toUpperCase() ?? ''];
  return <span className={cn('inline-flex max-w-full min-w-0 items-center gap-1 align-top', className)}>
    {resolvedResource && <Image src={resourceIcons[resolvedResource]} alt="" aria-hidden="true" width={14} height={14} className="h-3.5 w-3.5 shrink-0 object-contain" />}
    <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
  </span>;
}
