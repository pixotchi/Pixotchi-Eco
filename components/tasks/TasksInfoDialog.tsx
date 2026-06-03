"use client";

import React, { useEffect, useState } from "react";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useAccount } from "wagmi";
import Image from "next/image";
import { CLIENT_ENV } from "@/lib/env-config";
import { getClientGamificationPolicy } from "@/lib/gamification-client";
import { onTasksDialogOpen } from "@/lib/app-events";
import type { GmMissionDay } from "@/lib/gamification-types";
import { CheckCircle2, Circle, Flame, Sprout, Target, Trophy } from "lucide-react";

type MissionTask = {
  done?: boolean;
  label: string;
};

type MissionSection = {
  icon: React.ComponentType<{ className?: string }>;
  reward: number;
  tasks: MissionTask[];
  title: string;
};

function ProgressBar({ label, value }: { label: string; value: number }) {
  const normalizedValue = Math.max(0, Math.min(100, value));

  return (
    <div
      aria-label={label}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={Math.round(normalizedValue)}
      className="h-2 overflow-hidden rounded-full bg-muted"
      role="progressbar"
    >
      <div
        className="h-full rounded-full bg-[hsl(var(--success))] transition-[width] duration-[var(--motion-standard)] ease-[var(--ease-standard)]"
        style={{ width: `${normalizedValue}%` }}
      />
    </div>
  );
}

function MissionCard({ section }: { section: MissionSection }) {
  const completed = section.tasks.filter((task) => task.done).length;
  const progress = section.tasks.length > 0 ? (completed / section.tasks.length) * 100 : 0;
  const Icon = section.icon;

  return (
    <section className="rounded-[var(--radius-panel)] border border-border/65 bg-background/45 p-3.5 shadow-[var(--shadow-hairline)]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-primary/10 text-primary">
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold leading-tight">{section.title}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{section.reward} Rocks available</p>
          </div>
        </div>
        <div className="shrink-0 rounded-full border border-border/70 bg-background/70 px-2 py-1 text-xs font-semibold tabular-nums">
          {completed}/{section.tasks.length}
        </div>
      </div>

      <div className="mt-3">
        <ProgressBar label={`${section.title} progress`} value={progress} />
      </div>

      <ul className="mt-3 space-y-2">
        {section.tasks.map((task) => {
          const StatusIcon = task.done ? CheckCircle2 : Circle;
          return (
            <li key={task.label} className="flex items-start gap-2 text-sm leading-snug">
              <StatusIcon
                className={task.done ? "mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--success))]" : "mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50"}
                aria-hidden="true"
              />
              <span className={task.done ? "text-foreground" : "text-muted-foreground"}>{task.label}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

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

  const missionSections: MissionSection[] = [
    {
      icon: Target,
      reward: 30,
      title: "General",
      tasks: [
        { done: missionDay?.s1?.makeSwap, label: "Make a SEED swap" },
        { done: missionDay?.s1?.stakeSeed, label: "Stake SEED" },
        { done: missionDay?.s1?.claimStake, label: "Claim stake rewards" },
        { done: missionDay?.s1?.placeOrder, label: "Place a SEED/LEAF order" },
      ],
    },
    {
      icon: Sprout,
      reward: 20,
      title: "Social",
      tasks: [
        { done: missionDay?.s2?.followPlayer, label: "Follow a player" },
        { done: missionDay?.s2?.chatMessage, label: "Send a message in public chat" },
        { done: missionDay?.s2?.visitProfile, label: "Visit a profile" },
      ],
    },
    {
      icon: Trophy,
      reward: 25,
      title: "Land",
      tasks: [
        { done: missionDay?.s3?.applyResources, label: "Apply resources or production to a plant" },
        { done: missionDay?.s3?.sendQuest, label: "Send a farmer on a quest" },
        { done: missionDay?.s3?.claimProduction, label: "Claim production from any building" },
        { done: missionDay?.s3?.playCasinoGame, label: "Play roulette or blackjack" },
      ],
    },
    {
      icon: Flame,
      reward: 25,
      title: "Plant",
      tasks: [
        { done: missionDay?.s4?.buy10, label: "Buy at least 10 elements" },
        { done: missionDay?.s4?.buyShield, label: "Buy a shield or fence" },
        { done: missionDay?.s4?.collectStar, label: "Collect a star by killing a plant" },
        { done: missionDay?.s4?.playArcade, label: "Play Box or Spin in the arcade" },
      ],
    },
  ];
  const completedTaskCount = missionSections.reduce(
    (total, section) => total + section.tasks.filter((task) => task.done).length,
    0
  );
  const totalTaskCount = missionSections.reduce((total, section) => total + section.tasks.length, 0);
  const dailyProgress = Math.max(0, Math.min(100, missionPts));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent mobileMode="sheet" surface="soft" className="w-[min(95vw,34rem)] max-w-lg max-h-[calc(100dvh-1rem)] rounded-[var(--radius-dialog)]">
        <DialogHeader className="space-y-2">
          <DialogTitle className="flex items-center gap-2">
            <Image src="/icons/Volcanic_Rock.svg" alt="" width={20} height={20} className="h-5 w-5" aria-hidden="true" />
            Farmer&apos;s Tasks
          </DialogTitle>
          <DialogDescription className="leading-relaxed">
            Earn up to 100 Rocks per day. Daily reset is 00:00 UTC.
          </DialogDescription>
          {!effectiveDisabled && (
            <div className="mt-2 space-y-3 rounded-[var(--radius-panel)] border border-border/65 bg-background/45 p-3.5 shadow-[var(--shadow-hairline)]">
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <span className="text-xs font-semibold text-muted-foreground">Streak</span>
                  <div className="mt-1 flex items-baseline gap-1">
                    <span className="text-2xl font-bold leading-none tabular-nums">{streak?.current ?? 0}</span>
                    <span className="text-xs text-muted-foreground">days</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">Best {streak?.best ?? 0}</p>
                </div>

                <div>
                  <span className="text-xs font-semibold text-muted-foreground">Today</span>
                  <div className="mt-1 flex items-baseline gap-1">
                    <span className="text-2xl font-bold leading-none tabular-nums">{missionPts}</span>
                    <span className="text-xs text-muted-foreground">/100</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">Rocks</p>
                </div>

                <div>
                  <span className="text-xs font-semibold text-muted-foreground">Tasks</span>
                  <div className="mt-1 flex items-baseline gap-1">
                    <span className="text-2xl font-bold leading-none tabular-nums">{completedTaskCount}</span>
                    <span className="text-xs text-muted-foreground">/{totalTaskCount}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">Done</p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span>Daily progress</span>
                  <span className="font-medium tabular-nums">Lifetime {missionTotal}</span>
                </div>
                <ProgressBar label="Daily task reward progress" value={dailyProgress} />
              </div>
            </div>
          )}
        </DialogHeader>

        <DialogBody className="space-y-4 pb-2">
          {effectiveDisabled ? (
            <div className="rounded-[var(--radius-panel)] border border-amber-500/30 bg-amber-500/10 p-3.5">
              <p className="text-sm font-semibold">Temporarily Disabled</p>
              <p className="text-xs text-muted-foreground mt-1">{effectiveDisabledMessage}</p>
            </div>
          ) : (
            <>
              <div className="grid gap-3 pb-1 sm:grid-cols-2">
                {missionSections.map((section) => (
                  <MissionCard key={section.title} section={section} />
                ))}
              </div>
            </>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
