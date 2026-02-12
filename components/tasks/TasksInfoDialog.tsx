"use client";

import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useAccount } from "wagmi";
import Image from "next/image";
import { CLIENT_ENV } from "@/lib/env-config";

export default function TasksInfoDialog() {
  const { address } = useAccount();
  const gamificationDisabled = CLIENT_ENV.GAMIFICATION_DISABLED;
  const gamificationDisabledMessage = CLIENT_ENV.GAMIFICATION_DISABLED_MESSAGE;
  const [open, setOpen] = useState(false);
  const [missionDay, setMissionDay] = useState<any | null>(null);
  const [missionPts, setMissionPts] = useState<number>(0);
  const [missionTotal, setMissionTotal] = useState<number>(0);
  const [streak, setStreak] = useState<{ current: number; best: number } | null>(null);
  const [serverDisabledMessage, setServerDisabledMessage] = useState<string | null>(null);
  const effectiveDisabled = gamificationDisabled || !!serverDisabledMessage;
  const effectiveDisabledMessage = serverDisabledMessage || gamificationDisabledMessage;

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener('pixotchi:openTasks' as any, handler as EventListener);
    return () => window.removeEventListener('pixotchi:openTasks' as any, handler as EventListener);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        if (!address || !open || gamificationDisabled) return;

        setServerDisabledMessage(null);

        // Fetch streak data
        const sRes = await fetch(`/api/gamification/streak?address=${address}`);
        if (sRes.ok) {
          const s = await sRes.json();
          if (s?.disabled) {
            setServerDisabledMessage(typeof s?.message === 'string' ? s.message : gamificationDisabledMessage);
            return;
          }
          setStreak({ current: s.streak.current, best: s.streak.best });
        }

        // Fetch missions data
        const mRes = await fetch(`/api/gamification/missions?address=${address}`);
        if (mRes.ok) {
          const m = await mRes.json();
          if (m?.disabled) {
            setServerDisabledMessage(typeof m?.message === 'string' ? m.message : gamificationDisabledMessage);
            return;
          }
          setMissionDay(m.day || null);
          setMissionPts(m.day?.pts ?? 0);
          setMissionTotal(typeof m.total === 'number' && Number.isFinite(m.total) ? m.total : 0);
        }
      } catch { }
    })();
  }, [address, open, gamificationDisabled, gamificationDisabledMessage]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Farmer's Tasks</DialogTitle>
          <DialogDescription>
            Earn up to 100 Rock per day by completing 4 sections. Daily reset at 00:00 UTC.
          </DialogDescription>
        </DialogHeader>

        {effectiveDisabled ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
            <p className="text-sm font-semibold">Temporarily Disabled</p>
            <p className="text-xs text-muted-foreground mt-1">{effectiveDisabledMessage}</p>
          </div>
        ) : (
          <>
            {/* Progress Card - Streak & Rocks */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              {/* Streak */}
              <div className="p-3 rounded-lg bg-primary/10 border border-primary/20">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-muted-foreground">Streak</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" className="animate-streak-colors" aria-hidden="true">
                    <rect x="2" y="2" width="20" height="20" rx="3" />
                  </svg>
                </div>
                <p className="text-xl font-bold">{streak?.current ?? 0}</p>
                <p className="text-[10px] text-muted-foreground">Best: {streak?.best ?? 0}</p>
              </div>

              {/* Today's Rock */}
              <div className="p-3 rounded-lg bg-muted">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-muted-foreground">Today</span>
                  <Image src="/icons/Volcanic_Rock.svg" alt="Rock" width={16} height={16} />
                </div>
                <p className="text-xl font-bold">{missionPts} / 100</p>
                <p className="text-[10px] text-muted-foreground">Lifetime: {missionTotal}</p>
              </div>
            </div>

            {/* Task Sections */}
            <div className="space-y-3 text-sm">
              <div>
                <div className="font-medium">Section 1 - General (30 Rocks)</div>
                <ul className="list-disc pl-5 text-muted-foreground text-xs space-y-1 mt-1">
                  <li className="flex items-center gap-2"><span className={`inline-block w-2 h-2 rounded-full ${missionDay?.s1?.makeSwap ? 'bg-green-500' : 'bg-muted-foreground/40'}`}></span> Make a SEED swap</li>
                  <li className="flex items-center gap-2"><span className={`inline-block w-2 h-2 rounded-full ${missionDay?.s1?.stakeSeed ? 'bg-green-500' : 'bg-muted-foreground/40'}`}></span> Stake SEED</li>
                  <li className="flex items-center gap-2"><span className={`inline-block w-2 h-2 rounded-full ${missionDay?.s1?.claimStake ? 'bg-green-500' : 'bg-muted-foreground/40'}`}></span> Claim stake rewards</li>
                  <li className="flex items-center gap-2"><span className={`inline-block w-2 h-2 rounded-full ${missionDay?.s1?.placeOrder ? 'bg-green-500' : 'bg-muted-foreground/40'}`}></span> Place a SEED/LEAF order</li>
                </ul>
              </div>
              <div>
                <div className="font-medium">Section 2 - Social (20 Rocks)</div>
                <ul className="list-disc pl-5 text-muted-foreground text-xs space-y-1 mt-1">
                  <li className="flex items-center gap-2"><span className={`inline-block w-2 h-2 rounded-full ${missionDay?.s2?.followPlayer ? 'bg-green-500' : 'bg-muted-foreground/40'}`}></span> Follow a player</li>
                  <li className="flex items-center gap-2"><span className={`inline-block w-2 h-2 rounded-full ${missionDay?.s2?.chatMessage ? 'bg-green-500' : 'bg-muted-foreground/40'}`}></span> Send a message in public chat</li>
                  <li className="flex items-center gap-2"><span className={`inline-block w-2 h-2 rounded-full ${missionDay?.s2?.visitProfile ? 'bg-green-500' : 'bg-muted-foreground/40'}`}></span> Visit a profile</li>
                </ul>
              </div>
              <div>
                <div className="font-medium">Section 3 - Land (25 Rocks)</div>
                <ul className="list-disc pl-5 text-muted-foreground text-xs space-y-1 mt-1">
                  <li className="flex items-center gap-2"><span className={`inline-block w-2 h-2 rounded-full ${missionDay?.s3?.applyResources ? 'bg-green-500' : 'bg-muted-foreground/40'}`}></span> Apply resources/production to a plant</li>
                  <li className="flex items-center gap-2"><span className={`inline-block w-2 h-2 rounded-full ${missionDay?.s3?.sendQuest ? 'bg-green-500' : 'bg-muted-foreground/40'}`}></span> Send a farmer on a quest</li>
                  <li className="flex items-center gap-2"><span className={`inline-block w-2 h-2 rounded-full ${missionDay?.s3?.claimProduction ? 'bg-green-500' : 'bg-muted-foreground/40'}`}></span> Claim production from any building</li>
                  <li className="flex items-center gap-2"><span className={`inline-block w-2 h-2 rounded-full ${missionDay?.s3?.playCasinoGame ? 'bg-green-500' : 'bg-muted-foreground/40'}`}></span> Play a casino game (roulette/blackjack)</li>
                </ul>
              </div>
              <div>
                <div className="font-medium">Section 4 - Plant (25 Rocks)</div>
                <ul className="list-disc pl-5 text-muted-foreground text-xs space-y-1 mt-1">
                  <li className="flex items-center gap-2"><span className={`inline-block w-2 h-2 rounded-full ${missionDay?.s4?.buy10 ? 'bg-green-500' : 'bg-muted-foreground/40'}`}></span> Buy at least 10 elements</li>
                  <li className="flex items-center gap-2"><span className={`inline-block w-2 h-2 rounded-full ${missionDay?.s4?.buyShield ? 'bg-green-500' : 'bg-muted-foreground/40'}`}></span> Buy a shield/fence</li>
                  <li className="flex items-center gap-2"><span className={`inline-block w-2 h-2 rounded-full ${missionDay?.s4?.collectStar ? 'bg-green-500' : 'bg-muted-foreground/40'}`}></span> Collect a star by killing a plant</li>
                  <li className="flex items-center gap-2"><span className={`inline-block w-2 h-2 rounded-full ${missionDay?.s4?.playArcade ? 'bg-green-500' : 'bg-muted-foreground/40'}`}></span> Play an arcade game (Box or Spin)</li>
                </ul>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
