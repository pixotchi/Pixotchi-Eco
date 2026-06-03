"use client";

import React from 'react';
import { Button } from '@/components/ui/button';

export default function StakeHousePanel() {
  const handleOpenStaking = () => {
    try {
      // Dispatch a global event that the StatusBar component listens for
      window.dispatchEvent(new Event('staking:open'));
    } catch {}
  };

  return (
    <div className="text-center py-4 space-y-2">
      <div className="text-muted-foreground text-sm">
        Stake your SEED to earn LEAF.
      </div>
      <Button
        className="px-4 text-sm"
        onClick={handleOpenStaking}
      >
        Stake
      </Button>
    </div>
  );
}
