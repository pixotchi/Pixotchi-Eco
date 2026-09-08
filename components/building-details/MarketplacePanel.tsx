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
    <div className="space-y-4">
      <div className="text-muted-foreground text-sm">
        Trade SEED and LEAF with other players at your chosen price.
      </div>
      <div>
        <Button className="w-full text-sm" onClick={() => setMarketOpen(true)}>
          Open Marketplace
        </Button>
      </div>
      <MarketplaceDialog open={marketOpen} onOpenChange={setMarketOpen} landId={landId} />
    </div>
  );
}
