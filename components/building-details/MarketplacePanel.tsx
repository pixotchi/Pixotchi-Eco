"use client";

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import MarketplaceDialog from '@/components/transactions/marketplace-dialog';

interface MarketplacePanelProps {
  landId: bigint;
}

export default function MarketplacePanel({ landId }: MarketplacePanelProps) {
  const [marketOpen, setMarketOpen] = useState(false);

  return (
    <div className="text-center py-4 space-y-2">
      <div className="text-muted-foreground text-sm">
        In this building you can trade SEED/LEAF by placing buy/sell orders.
      </div>
      <div className="pt-2">
        <Button className="h-9 px-3 text-sm" onClick={() => setMarketOpen(true)}>
          Open Marketplace
        </Button>
      </div>
      <MarketplaceDialog open={marketOpen} onOpenChange={setMarketOpen} landId={landId} />
    </div>
  );
}
