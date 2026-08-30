"use client";

import React, { useEffect, useRef, useState } from "react";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useAccount } from "wagmi";
import Image from "next/image";
import { CLIENT_ENV } from "@/lib/env-config";
import { getClientGamificationPolicy } from "@/lib/gamification-client";
import { onTasksDialogOpen } from "@/lib/app-events";
import type { GmMissionDay } from "@/lib/gamification-types";
import {
  flushMissionProgressOutbox,
  onMissionTrackingEvent,
} from "@/lib/mission-tracking";
import { CheckCircle2, Circle } from "lucide-react";
import { ProgressBar } from "@/components/ui/progress-bar";

type MissionTask = {
  done?: boolean;
  label: string;
};

type MissionSection = {
  reward: number;
  tasks: MissionTask[];
  title: string;
};

function MissionCard({ section }: { section: MissionSection }) {
  const completed = section.tasks.filter((task) => task.done).length;
  const progress = section.tasks.length > 0 ? (completed / section.tasks.length) * 100 : 0;

  return (
    <section className="chromatic-white-surface rounded-[var(--radius-panel)] border border-border/60 bg-card/90 bg-[image:var(--gradient-surface)] p-3.5 shadow-[var(--shadow-hairline)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold leading-tight">{section.title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{section.reward} Rocks available</p>
        </div>
        <div className="shrink-0 rounded-[var(--radius-control)] border border-border/60 bg-card/80 px-2 py-1 text-xs font-semibold tabular-nums">
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
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryVersion, setSummaryVersion] = useState(0);
  const [missionTrackingNotice, setMissionTrackingNotice] = useState<{
    message: string;
    status: 'error' | 'queued';
  } | null>(null);
  const summaryRequestGenerationRef = useRef(0);
  const previousSummaryAddressRef = useRef<string | null>(null);
  const effectiveDisabled = !gamificationPolicy.enabled || !!serverDisabledMessage;
  const effectiveDisabledMessage =
    serverDisabledMessage ||
    gamificationPolicy.message ||
    gamificationDisabledMessage;

  useEffect(() => {
    return onTasksDialogOpen(() => setOpen(true));
  }, []);

  useEffect(() => {
    return onMissionTrackingEvent((detail) => {
      const eventAddress = typeof detail.payload.address === 'string'
        ? detail.payload.address.toLowerCase()
        : null;
      if (!address || !eventAddress || eventAddress !== address.toLowerCase()) {
        return;
      }

      if (detail.status === 'success') {
        setMissionTrackingNotice(null);
        if (open) {
          setSummaryVersion((version) => version + 1);
        }
        return;
      }

      setMissionTrackingNotice({
        message: detail.message ?? 'Task progress could not be synced.',
        status: detail.status,
      });
    });
  }, [address, open]);

  useEffect(() => {
    void flushMissionProgressOutbox();
  }, [open]);

  useEffect(() => {
    const normalizedAddress = address?.toLowerCase() ?? null;
    if (previousSummaryAddressRef.current === normalizedAddress) {
      return;
    }

    previousSummaryAddressRef.current = normalizedAddress;
    setMissionDay(null);
    setMissionPts(0);
    setMissionTotal(0);
    setStreak(null);
    setServerDisabledMessage(null);
    setSummaryError(null);
    setMissionTrackingNotice(null);
  }, [address]);

  useEffect(() => {
    // Abort on close/wallet switch (a switch mid-flight used to paint the
    // previous wallet's streak), track loading so the summary shows skeletons
    // instead of confident zeros, and surface failures instead of swallowing
    // them into a "Streak 0 / Tasks 0" card.
    const generation = summaryRequestGenerationRef.current + 1;
    summaryRequestGenerationRef.current = generation;
    if (!address || !open || !gamificationPolicy.enabled) {
      setSummaryLoading(false);
      return;
    }
    const controller = new AbortController();
    const isCurrentRequest = () =>
      !controller.signal.aborted &&
      summaryRequestGenerationRef.current === generation;

    (async () => {
      try {
        setServerDisabledMessage(null);
        setSummaryError(null);
        setSummaryLoading(true);

        const [sRes, mRes] = await Promise.all([
          fetch(`/api/gamification/streak?address=${address}`, { signal: controller.signal }),
          fetch(`/api/gamification/missions?address=${address}`, { signal: controller.signal }),
        ]);

        if (sRes.ok) {
          const sPayload = await sRes.json();
          if (!isCurrentRequest()) return;
          if (sPayload?.disabled) {
            setServerDisabledMessage(typeof sPayload?.message === 'string' ? sPayload.message : gamificationDisabledMessage);
            return;
          }
          setStreak({ current: sPayload.streak.current, best: sPayload.streak.best });
        } else {
          throw new Error(`Streak request failed (${sRes.status})`);
        }

        if (mRes.ok) {
          const m = await mRes.json();
          if (!isCurrentRequest()) return;
          if (m?.disabled) {
            setServerDisabledMessage(typeof m?.message === 'string' ? m.message : gamificationDisabledMessage);
            return;
          }
          setMissionDay(m.day || null);
          setMissionPts(m.day?.pts ?? 0);
          setMissionTotal(typeof m.total === 'number' && Number.isFinite(m.total) ? m.total : 0);
        } else {
          throw new Error(`Missions request failed (${mRes.status})`);
        }
      } catch (error) {
        if ((error as Error)?.name !== 'AbortError' && isCurrentRequest()) {
          console.warn('[Tasks] Failed to load summary:', error);
          setSummaryError('Could not load your progress. Close and reopen to retry.');
        }
      } finally {
        if (isCurrentRequest()) {
          setSummaryLoading(false);
        }
      }
    })();

    return () => {
      controller.abort();
      if (summaryRequestGenerationRef.current === generation) {
        summaryRequestGenerationRef.current += 1;
      }
    };
  }, [address, open, gamificationPolicy.enabled, gamificationDisabledMessage, summaryVersion]);

  useEffect(() => {
    if (gamificationPolicy.visible) return;
    setOpen(false);
  }, [gamificationPolicy.visible]);

  if (!gamificationPolicy.visible) {
    return null;
  }

  const missionSections: MissionSection[] = [
    {
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
      reward: 20,
      title: "Social",
      tasks: [
        { done: missionDay?.s2?.followPlayer, label: "Follow a player" },
        { done: missionDay?.s2?.chatMessage, label: "Send a message in public chat" },
        { done: missionDay?.s2?.visitProfile, label: "Visit a profile" },
      ],
    },
    {
      reward: 25,
      title: "Land",
      tasks: [
        { done: missionDay?.s3?.applyResources, label: "Apply resources or production to a plant" },
        { done: missionDay?.s3?.sendQuest, label: "Send a farmer on a quest" },
        { done: missionDay?.s3?.claimProduction, label: "Claim production from any building" },
        { done: missionDay?.s3?.playCasinoGame, label: "Play roulette, blackjack, or baccarat" },
      ],
    },
    {
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
  const summaryCard = (
    <div
      className="chromatic-white-surface space-y-3 rounded-[var(--radius-panel)] border border-border/60 bg-card/95 bg-[image:var(--gradient-surface)] p-3.5 shadow-[var(--shadow-hairline)] backdrop-blur-[var(--blur-surface)]"
      data-task-summary-card
    >
      {summaryError && (
        <p className="text-xs text-[hsl(var(--warning-strong))]" role="status">{summaryError}</p>
      )}
      {missionTrackingNotice && (
        <p className="text-xs text-[hsl(var(--warning-strong))]" role="status">
          {missionTrackingNotice.message}
        </p>
      )}
      <div className="grid grid-cols-3 gap-2" aria-busy={summaryLoading || undefined}>
        <div>
          <span className="text-xs font-semibold text-muted-foreground">Streak</span>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="text-2xl font-bold leading-none tabular-nums">{summaryLoading ? "–" : streak?.current ?? 0}</span>
            <span className="text-xs text-muted-foreground">days</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Best {streak?.best ?? 0}</p>
        </div>

        <div>
          <span className="text-xs font-semibold text-muted-foreground">Today</span>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="text-2xl font-bold leading-none tabular-nums">{summaryLoading ? "–" : missionPts}</span>
            <span className="text-xs text-muted-foreground">/100</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Rocks</p>
        </div>

        <div>
          <span className="text-xs font-semibold text-muted-foreground">Tasks</span>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="text-2xl font-bold leading-none tabular-nums">{summaryLoading ? "–" : completedTaskCount}</span>
            <span className="text-xs text-muted-foreground">/{totalTaskCount}</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Done</p>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>Daily progress</span>
          <span className="font-medium tabular-nums">Total {missionTotal}</span>
        </div>
        <ProgressBar label="Daily task reward progress" value={dailyProgress} />
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent mobileMode="center" surface="soft" className="w-[min(94vw,28rem)] max-w-md">
        <DialogHeader className="space-y-2">
          <DialogTitle className="flex items-center gap-2">
            <Image src="/icons/Volcanic_Rock.svg" alt="" width={20} height={20} className="h-5 w-5" aria-hidden="true" />
            Farmer&apos;s Tasks
          </DialogTitle>
          <DialogDescription className="leading-relaxed">
            Earn up to 100 Rocks per day. Daily reset is 00:00 UTC.
          </DialogDescription>
          {!effectiveDisabled && summaryCard}
        </DialogHeader>

        <DialogBody className="space-y-4 pr-1">
          {effectiveDisabled ? (
            <div className="rounded-[var(--radius-panel)] border border-[hsl(var(--warning)/0.3)] bg-[hsl(var(--warning)/0.1)] p-3.5">
              <p className="text-sm font-semibold">Temporarily Disabled</p>
              <p className="text-xs text-muted-foreground mt-1">{effectiveDisabledMessage}</p>
            </div>
          ) : (
            <div className="grid gap-3 pb-1 sm:grid-cols-2">
              {missionSections.map((section) => (
                <MissionCard key={section.title} section={section} />
              ))}
            </div>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
