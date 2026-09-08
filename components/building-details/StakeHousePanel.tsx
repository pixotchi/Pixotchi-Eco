"use client";

import React from 'react';
import { Button } from '@/components/ui/button';
import { openStakingDialog } from '@/lib/app-events';

export default function StakeHousePanel() {
  const handleOpenStaking = () => {
    // The typed helper dispatches both the namespaced and legacy event names
    // the StatusBar listener subscribes to (this used to hand-dispatch the
    // legacy name only, leaving the exported helper apparently dead).
    openStakingDialog();
  };

  return (
    <div className="space-y-4">
      <div className="text-muted-foreground text-sm">
        Stake your SEED to earn LEAF.
      </div>
      <Button
        className="w-full text-sm"
        onClick={handleOpenStaking}
      >
        Stake
      </Button>
    </div>
  );
}
