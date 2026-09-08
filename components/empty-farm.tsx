'use client';

import { Flower2, LandPlot } from 'lucide-react';
import { useFarmView } from '@/lib/farm-view-context';
import { navigateToGameTab } from '@/lib/game-navigation';
import { Button } from './ui/button';
import { EmptyState } from './ui/empty-state';

export function EmptyFarm({ asset }: { asset: 'plant' | 'land' }) {
  const { setMintType } = useFarmView();
  return <EmptyState icon={asset === 'plant' ? Flower2 : LandPlot} className="py-10"
    title={asset === 'plant' ? 'Your farm starts here' : 'Your first plot awaits'}
    description={asset === 'plant' ? 'Choose a plant you like and review its mint price, payment token and available supply.' : 'Review the plot price and payment options before minting. Land requires an EVM wallet.'}
    action={<Button onClick={() => { setMintType(asset); navigateToGameTab('mint'); }}>Get your first {asset}</Button>} />;
}
