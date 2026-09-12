'use client';

import { Flower2, LandPlot } from 'lucide-react';
import Image from 'next/image';
import { useFarmView } from '@/lib/farm-view-context';
import { navigateToGameTab } from '@/lib/game-navigation';
import { Button } from './ui/button';
import { EmptyState } from './ui/empty-state';
import { StrainPreview } from './strain-preview';

export function EmptyFarm({ asset }: { asset: 'plant' | 'land' }) {
  const { setMintType } = useFarmView();
  return <EmptyState icon={asset === 'plant' ? Flower2 : LandPlot} className="py-10"
    level="page" illustration={asset === 'plant' ? <StrainPreview /> : <Image
      src="/icons/village-start.png" alt="A Pixotchi land with empty building plots, paths and a river"
      width={192} height={192} className="mx-auto h-48 w-48 object-contain [image-rendering:pixelated]" />}
    title={asset === 'plant' ? 'Your farm starts here' : 'Your first plot awaits'}
    description={asset === 'plant' ? 'Care for your plant and grow its points to earn a share of ETH rewards. Rewards vary with each distribution.' : 'Build a village that supplies your plants with points, lifetime and unlocks new activities! '}
    action={<Button onClick={() => { setMintType(asset); navigateToGameTab('mint'); }}>Get your first {asset}</Button>} />;
}
