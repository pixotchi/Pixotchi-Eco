"use client";

import React, { useEffect, useState } from "react";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useAccount } from "wagmi";
import Image from "next/image";
import { CLIENT_ENV } from "@/lib/env-config";
import { getClientGamificationPolicy } from "@/lib/gamification-client";
import { onTasksDialogOpen } from "@/lib/app-events";
import type { GmMissionDay } from "@/lib/gamification-types";

export default function TasksInfoDialog() {
  const { address } = useAccount();
  const gamificationDisabledMessage = CLIENT_ENV.GAMIFICATION_DISABLED_MESSAGE;
  const gamificationPolicy = getClientGamificationPolicy();
  const [open, setOpen] = useState(false);
  const [missionDay, setMissionDay] = useState<GmMissionDay | null>(null);
  const [missionPts, setMissionPts] = useState<number>(0);
  const [missionTotal, setMissionTotal] = useState<number>(0);
  const [streak, setStreak] = useState<{ current: number; best: number } | null>(null);
  const [serverDisabledMessage, setServerDisabledMessage] = useState<string | null>(null);
  const effectiveDisabled = !gamificationPolicy.enabled || !!serverDisabledMessage;
  const effectiveDisabledMessage =
    serverDisabledMessage ||
    gamificationPolicy.message ||
    gamificationDisabledMessage;
  const taskDotClass = (done?: boolean) =>
    `mt-[0.35rem] inline-block h-2 w-2 shrink-0 rounded-full ${done ? 'bg-[hsl(var(--success))]' : 'bg-muted-foreground/40'}`;

  useEffect(() => {
    return onTasksDialogOpen(() => setOpen(true));
  }, []);

  useEffect(() => {
    (async () => {
      try {
        if (!address || !open || !gamificationPolicy.enabled) return;

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
  }, [address, open, gamificationPolicy.enabled, gamificationDisabledMessage]);

  useEffect(() => {
    if (gamificationPolicy.visible) return;
    setOpen(false);
  }, [gamificationPolicy.visible]);

  if (!gamificationPolicy.visible) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent mobileMode="center" surface="soft" className="w-[min(94vw,28rem)] max-w-md max-h-[calc(100dvh-2rem)] rounded-[var(--radius-dialog)]">
        <DialogHeader className="space-y-2">
          <DialogTitle>Farmer&apos;s Tasks</DialogTitle>
          <DialogDescription className="leading-relaxed">
            Earn up to 100 Rock per day. Daily reset is 00:00 UTC.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="mt-5 space-y-5 pb-2">
        {effectiveDisabled ? (
          <div className="rounded-[var(--radius-panel)] border border-amber-500/30 bg-amber-500/10 p-3.5">
            <p className="text-sm font-semibold">Temporarily Disabled</p>
            <p className="text-xs text-muted-foreground mt-1">{effectiveDisabledMessage}</p>
          </div>
        ) : (
          <>
            <div className="sticky top-0 z-10 grid grid-cols-2 gap-3 rounded-[var(--radius-panel)] bg-card/95 pb-1 backdrop-blur-sm">
              <div className="relative overflow-hidden rounded-[var(--radius-panel)] border border-primary/20 bg-primary/10 p-3.5">
                <svg
                  width="44"
                  height="44"
                  viewBox="0 0 24 24"
                  className="absolute right-2.5 top-1/2 h-11 w-11 -translate-y-1/2 animate-streak-colors opacity-55"
                  aria-hidden="true"
                >
                  <rect x="2" y="2" width="20" height="20" rx="3" />
                </svg>
                <div className="relative z-[1] max-w-[calc(100%-2.75rem)]">
                  <span className="text-xs font-semibold text-muted-foreground">Streak</span>
                  <div className="mt-2 flex items-baseline gap-1">
                    <span className="text-[1.7rem] font-bold leading-none">{streak?.current ?? 0}</span>
                    <span className="text-xs text-muted-foreground">days</span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">Best {streak?.best ?? 0}</p>
                </div>
              </div>

              <div className="relative overflow-hidden rounded-[var(--radius-panel)] border border-border/65 bg-muted/55 p-3.5">
                <Image
                  src="/icons/Volcanic_Rock.svg"
                  alt=""
                  width={48}
                  height={48}
                  className="absolute right-2 top-1/2 h-12 w-12 -translate-y-1/2 opacity-60"
                  aria-hidden="true"
                />
                <div className="relative z-[1] max-w-[calc(100%-2.75rem)]">
                  <span className="text-xs font-semibold text-muted-foreground">Today</span>
                  <div className="mt-2 flex items-baseline gap-1">
                    <span className="text-[1.7rem] font-bold leading-none">{missionPts}</span>
                    <span className="text-xs text-muted-foreground">/ 100</span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">Lifetime {missionTotal}</p>
                </div>
              </div>
            </div>

            <div className="divide-y divide-border/60 pb-1 text-sm">
              <section className="pb-4">
                <div className="font-semibold leading-tight">Section 1 - General (30 Rocks)</div>
                <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
                  <li className="flex items-center gap-2"><span className={taskDotClass(missionDay?.s1?.makeSwap)}></span> Make a SEED swap</li>
                  <li className="flex items-center gap-2"><span className={taskDotClass(missionDay?.s1?.stakeSeed)}></span> Stake SEED</li>
                  <li className="flex items-center gap-2"><span className={taskDotClass(missionDay?.s1?.claimStake)}></span> Claim stake rewards</li>
                  <li className="flex items-center gap-2"><span className={taskDotClass(missionDay?.s1?.placeOrder)}></span> Place a SEED/LEAF order</li>
                </ul>
              </section>
              <section className="py-4">
                <div className="font-semibold leading-tight">Section 2 - Social (20 Rocks)</div>
                <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
                  <li className="flex items-center gap-2"><span className={taskDotClass(missionDay?.s2?.followPlayer)}></span> Follow a player</li>
                  <li className="flex items-center gap-2"><span className={taskDotClass(missionDay?.s2?.chatMessage)}></span> Send a message in public chat</li>
                  <li className="flex items-center gap-2"><span className={taskDotClass(missionDay?.s2?.visitProfile)}></span> Visit a profile</li>
                </ul>
              </section>
              <section className="py-4">
                <div className="font-semibold leading-tight">Section 3 - Land (25 Rocks)</div>
                <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
                  <li className="flex items-center gap-2"><span className={taskDotClass(missionDay?.s3?.applyResources)}></span> Apply resources/production to a plant</li>
                  <li className="flex items-center gap-2"><span className={taskDotClass(missionDay?.s3?.sendQuest)}></span> Send a farmer on a quest</li>
                  <li className="flex items-center gap-2"><span className={taskDotClass(missionDay?.s3?.claimProduction)}></span> Claim production from any building</li>
                  <li className="flex items-center gap-2"><span className={taskDotClass(missionDay?.s3?.playCasinoGame)}></span> Play a casino game (roulette/blackjack)</li>
                </ul>
              </section>
              <section className="pt-4">
                <div className="font-semibold leading-tight">Section 4 - Plant (25 Rocks)</div>
                <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
                  <li className="flex items-center gap-2"><span className={taskDotClass(missionDay?.s4?.buy10)}></span> Buy at least 10 elements</li>
                  <li className="flex items-center gap-2"><span className={taskDotClass(missionDay?.s4?.buyShield)}></span> Buy a shield/fence</li>
                  <li className="flex items-center gap-2"><span className={taskDotClass(missionDay?.s4?.collectStar)}></span> Collect a star by killing a plant</li>
                  <li className="flex items-center gap-2"><span className={taskDotClass(missionDay?.s4?.playArcade)}></span> Play an arcade game (Box or Spin)</li>
                </ul>
              </section>
            </div>
          </>
        )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
