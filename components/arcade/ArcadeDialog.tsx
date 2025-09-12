"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import Image from "next/image";
import { Card, CardContent } from "@/components/ui/card";
import { Plant } from "@/lib/types";
import { toast } from "react-hot-toast";
import { useAccount, usePublicClient } from "wagmi";
import BoxGameTransaction from "@/components/transactions/box-game-transaction";
import type { LifecycleStatus } from "@coinbase/onchainkit/transaction";
import { PIXOTCHI_NFT_ADDRESS } from "@/lib/contracts";
import { formatDuration } from "@/lib/utils";
import { usePaymaster } from "@/lib/paymaster-context";
import { useSmartWallet } from "@/lib/smart-wallet-context";
import { SponsoredBadge } from "@/components/paymaster-toggle";

// Minimal ABI entries for box game interactions
const BOX_GAME_ABI = [
  {
    inputs: [{ name: "nftID", type: "uint256" }],
    name: "boxGameGetCoolDownTimePerNFT",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "nftID", type: "uint256" }],
    name: "boxGameGetCoolDownTimeWithStar",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "nftID", type: "uint256" },
      { name: "seed", type: "uint256" },
    ],
    name: "boxGamePlay",
    outputs: [
      { name: "points", type: "uint256" },
      { name: "timeExtension", type: "uint256" },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "nftID", type: "uint256" },
      { name: "seed", type: "uint256" },
    ],
    name: "boxGamePlayWithStar",
    outputs: [
      { name: "points", type: "uint256" },
      { name: "timeExtension", type: "uint256" },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

type ArcadeDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plant: Plant;
};

export default function ArcadeDialog({ open, onOpenChange, plant }: ArcadeDialogProps) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { isSponsored } = usePaymaster();
  const { isSmartWallet } = useSmartWallet();
  const [selectedGame, setSelectedGame] = useState<'box' | null>('box');
  const [seed, setSeed] = useState<number | null>(null);
  const [withStar, setWithStar] = useState(false);
  const [cooldown, setCooldown] = useState<{ normal: number; star: number }>({ normal: 0, star: 0 });

  // Generate a deterministic-ish default seed on open
  useEffect(() => {
    if (open) {
      const s = Math.max(1, (Date.now() % 9) + 1);
      setSeed(s);
    }
  }, [open]);

  // Fetch cooldowns when dialog opens or when plant changes
  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!open || !publicClient || !plant) return;
      try {
        const [normal, star] = await Promise.all([
          publicClient.readContract({
            address: PIXOTCHI_NFT_ADDRESS,
            abi: BOX_GAME_ABI,
            functionName: 'boxGameGetCoolDownTimePerNFT',
            args: [BigInt(plant.id)],
          }) as Promise<bigint>,
          publicClient.readContract({
            address: PIXOTCHI_NFT_ADDRESS,
            abi: BOX_GAME_ABI,
            functionName: 'boxGameGetCoolDownTimeWithStar',
            args: [BigInt(plant.id)],
          }) as Promise<bigint>,
        ]);
        if (mounted) setCooldown({ normal: Number(normal), star: Number(star) });
      } catch {}
    })();
    return () => { mounted = false; };
  }, [open, plant, publicClient]);

  // Countdown tick
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => {
      setCooldown((prev: { normal: number; star: number }) => ({
        normal: Math.max(0, prev.normal - 1),
        star: Math.max(0, prev.star - 1),
      }));
    }, 1000);
    return () => clearInterval(id);
  }, [open]);

  const calls = useMemo(() => {
    if (!plant || !seed) return [] as any[];
    const fn = withStar ? 'boxGamePlayWithStar' : 'boxGamePlay';
    return [{
      address: PIXOTCHI_NFT_ADDRESS,
      abi: BOX_GAME_ABI,
      functionName: fn,
      args: [BigInt(plant.id), BigInt(seed)],
    }];
  }, [plant, seed, withStar]);

  const onStatus = useCallback((status: LifecycleStatus) => {
    if (status.statusName === 'success') {
      onOpenChange(false);
      try { window.dispatchEvent(new Event('balances:refresh')); } catch {}
    }
  }, [onOpenChange]);

  const BoxGrid = () => (
    <div className="grid grid-cols-3 gap-2">
      {Array.from({ length: 9 }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          onClick={() => setSeed(n)}
          className={`w-full h-16 sm:h-20 flex items-center justify-center rounded-lg border transition-colors ${seed === n ? 'bg-primary/10 border-primary ring-2 ring-primary/30' : 'bg-card hover:bg-accent border-border'}`}
          aria-label={`Select box ${n}`}
        >
          <Image src="/icons/box.png" alt={`Box ${n}`} width={32} height={32} className="w-8 h-8 object-contain" />
        </button>
      ))}
    </div>
  );

  const currentCooldown = withStar ? cooldown.star : cooldown.normal;
  const disabled = !seed || !address || currentCooldown > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Arcade</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-4">
          {/* Game selector (single for now) */}
          <div className="grid grid-cols-1 gap-2">
            <Card onClick={() => setSelectedGame('box')}>
              <CardContent className="p-3 flex items-center gap-3">
                <Image src="/icons/box.png" alt="Box Game" width={28} height={28} />
                <div className="flex-1">
                  <div className="text-sm font-semibold">Box Game</div>
                  <div className="text-xs text-muted-foreground">Pick a box and win PTS/TOD</div>
                </div>
                <span className="text-xs text-muted-foreground">Selected</span>
              </CardContent>
            </Card>
          </div>

          {selectedGame === 'box' && (
            <div className="space-y-3">
              <div className="text-sm font-medium">Choose a box</div>
              <BoxGrid />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <div><span className="font-medium">{withStar ? 'Playing with Stars' : 'Playing without Stars'}</span></div>
                <button
                  className="px-2 py-1 rounded-md border hover:bg-accent"
                  onClick={() => setWithStar((v: boolean) => !v)}
                >
                  {withStar ? 'Play without Stars' : 'Play with Stars'}
                </button>
              </div>
              <div className="text-xs text-muted-foreground">
                {currentCooldown > 0 ? (
                  <span>Cooldown: {formatDuration(currentCooldown)} remaining</span>
                ) : (
                  <span>Ready to play</span>
                )}
              </div>

              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <div>
                  Stars available: <span className="font-semibold text-foreground">{plant?.stars ?? 0}</span>
                </div>
                {withStar && (plant?.stars ?? 0) <= 0 && (
                  <span className="text-red-500">Not enough stars</span>
                )}
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Confirm Play</span>
                <SponsoredBadge show={isSponsored && isSmartWallet} />
              </div>

              <BoxGameTransaction
                plantId={plant.id}
                seed={seed as number}
                withStar={withStar}
                buttonText={withStar ? 'Play (Use Star)' : 'Play'}
                buttonClassName="w-full"
                disabled={disabled || (withStar && (plant?.stars ?? 0) <= 0)}
                onStatusUpdate={onStatus as any}
                showToast={true}
              />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}


