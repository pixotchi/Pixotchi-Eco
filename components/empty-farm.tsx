'use client';

import { Flower2, LandPlot } from 'lucide-react';
import { useFarmView } from '@/lib/farm-view-context';
import { navigateToGameTab } from '@/lib/game-navigation';
import { Button } from './ui/button';
import { EmptyState } from './ui/empty-state';
import { GardenPreview } from './garden-preview';

export function EmptyFarm({ asset }: { asset: 'plant' | 'land' }) {
  const { setMintType } = useFarmView();
  return <EmptyState icon={asset === 'plant' ? Flower2 : LandPlot} className="py-10"
    level="page" illustration={asset === 'plant' ? <GardenPreview compact /> : undefined}
    title={asset === 'plant' ? 'Your farm starts here' : 'Your first plot awaits'}
    description={asset === 'plant' ? 'Care for your plant and grow its points to earn a share of ETH rewards. Rewards vary with each distribution.' : 'Build a village that supplies your plants with points and lifetime. Review the plot price before minting. Land requires an EVM wallet.'}
    action={<Button onClick={() => { setMintType(asset); navigateToGameTab('mint'); }}>Get your first {asset}</Button>} />;
}
