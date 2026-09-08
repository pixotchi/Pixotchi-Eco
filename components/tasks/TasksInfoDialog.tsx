"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAccount } from "wagmi";
import Image from "next/image";
import { CLIENT_ENV } from "@/lib/env-config";
import { getClientGamificationPolicy } from "@/lib/gamification-client";
import { onTasksDialogOpen, openStakingDialog } from "@/lib/app-events";
import {
  flushMissionProgressOutbox,
  onMissionTrackingEvent,
} from "@/lib/mission-tracking";
import { CheckCircle2, Circle, HelpCircle, X } from "lucide-react";
import { ProgressBar } from "@/components/ui/progress-bar";
import {
  getMissionSections,
  parseMissionSummary,
  type MissionDestination,
  type MissionSummary,
} from "@/lib/mission-presentation";
import { completeFirstCareStep } from "@/lib/first-care-progress";
import { navigateToGameTab } from "@/lib/game-navigation";
import { clearMissionLandForOwner, openMissionLand, openPublicChat } from "@/lib/mission-navigation";
import { clearMissionPlantForOwner, openMissionPlant } from "@/lib/mission-plant-navigation";
import { useMissionAssets } from "@/hooks/useMissionAssets";
import { resolveMissionAction, type MissionAction, type MissionAssets } from "@/lib/mission-actions";

type MissionSection = ReturnType<typeof getMissionSections>[number];
function MissionCard({
  section,
  assets,
  onNavigate,
  onRetryAssets,
}: {
  section: MissionSection;
  assets: MissionAssets;
  onNavigate: (task: MissionSection["tasks"][number], action: MissionAction | null) => void;
  onRetryAssets: () => void;
}) {
  const known = section.earned !== undefined;
  const completed = section.tasks.filter((task) => task.done).length;
  return (
    <section
      aria-label={section.title + " tasks"}
      className="surface-lifted rounded-[var(--radius-panel)] border border-border/60 bg-card/90 bg-[image:var(--gradient-surface)] p-3.5 shadow-[var(--shadow-hairline)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold leading-tight">
            {section.title}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {section.earned
              ? section.reward + " Rocks earned"
              : section.reward + " Rocks when all tasks are complete"}
          </p>
        </div>
        <span className="shrink-0 text-xs tabular-nums">
          {known ? completed : "—"}/{section.tasks.length}
        </span>
      </div>
      {known && (
        <div className="mt-3">
          <ProgressBar
            label={section.title + " progress"}
            value={(completed / section.tasks.length) * 100}
          />
        </div>
      )}
      <ul className="mt-3 space-y-4">
        {section.tasks.map((task) => {
          const action = resolveMissionAction(task.id, assets);
          const actionLabel = action?.label ?? task.actionLabel;
          const prerequisite = action?.description ?? task.prerequisite;
          const Icon =
            task.done === undefined
              ? HelpCircle
              : task.done
                ? CheckCircle2
                : Circle;
          return (
            <li
              key={task.id}
              className="flex items-start gap-2 text-sm leading-snug"
              data-mission-id={task.id}
            >
              <Icon
                className={
                  task.done
                    ? "mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--success))]"
                    : "mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                }
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1 space-y-1">
                <p>{task.label}</p>
                <p className="text-xs text-muted-foreground">
                  {task.done === undefined
                    ? "Progress not yet available"
                    : task.done
                      ? "Completed"
                      : "Not completed"}
                </p>
                {task.done !== true && (
                  <>
                    {prerequisite && (
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {prerequisite}
                      </p>
                    )}
                    <Button
                      variant="outline"
                      size="compact"
                      className="h-auto max-w-full whitespace-normal leading-snug"
                      disabled={action?.disabled}
                      onClick={() => action?.retry ? onRetryAssets() : onNavigate(task, action)}
                      aria-label={actionLabel + ": " + task.label}
                    >
                      {actionLabel}
                    </Button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function navigateToMission(destination: MissionDestination) {
  if (destination === "stake") openStakingDialog();
  else if (destination === "chat") openPublicChat();
  else if (destination === "lands" || destination === "plants")
    navigateToGameTab("dashboard", { dashboardView: destination });
  else navigateToGameTab(destination === "ranking" ? "leaderboard" : "swap");
}

export default function TasksInfoDialog() {
  const { address } = useAccount();
  const owner = address?.toLowerCase() ?? null;
  const policy = getClientGamificationPolicy();
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<{
    owner: string;
    summary: MissionSummary;
  } | null>(null);
  const [failure, setFailure] = useState<{
    owner: string;
    message: string;
  } | null>(null);
  const [serverDisabled, setServerDisabled] = useState<{
    owner: string;
    message: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [version, setVersion] = useState(0);
  const [notice, setNotice] = useState<{
    owner: string;
    message: string;
  } | null>(null);
  const [lastTask, setLastTask] = useState<string | null>(null);
  const generation = useRef(0);
  const summary = snapshot?.owner === owner ? snapshot.summary : null;
  const error = failure?.owner === owner ? failure.message : null;
  const disabledMessage =
    serverDisabled?.owner === owner ? serverDisabled.message : null;
  const disabled = !policy.enabled || Boolean(disabledMessage);
  const { assets, retry: retryAssets } = useMissionAssets(owner, open && policy.visible && !disabled);
  const sections = getMissionSections(summary?.day ?? null);
  const completed = sections.reduce(
    (sum, section) => sum + section.tasks.filter((task) => task.done).length,
    0,
  );
  const totalTaskCount = sections.reduce(
    (sum, section) => sum + section.tasks.length,
    0,
  );

  useEffect(() => onTasksDialogOpen(() => setOpen(true)), []);
  useEffect(() => {
    clearMissionLandForOwner(owner);
    clearMissionPlantForOwner(owner);
  }, [owner]);
  useEffect(() => {
    void flushMissionProgressOutbox();
  }, [open]);
  useEffect(
    () =>
      onMissionTrackingEvent((detail) => {
        const eventOwner =
          typeof detail.payload.address === "string"
            ? detail.payload.address.toLowerCase()
            : null;
        if (!owner || eventOwner !== owner) return;
        if (detail.status === "success") {
          setNotice(null);
          if (open) setVersion((value) => value + 1);
        } else
          setNotice({
            owner,
            message: detail.message ?? "Task progress could not be synced.",
          });
      }),
    [owner, open],
  );
  useEffect(() => {
    const request = ++generation.current;
    if (!owner || !open || !policy.enabled) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const isCurrent = () =>
      !controller.signal.aborted && generation.current === request;
    setLoading(true);
    setFailure(null);
    setServerDisabled(null);
    void (async () => {
      try {
        const responses = await Promise.all([
          fetch("/api/gamification/streak?address=" + owner, {
            signal: controller.signal,
          }),
          fetch("/api/gamification/missions?address=" + owner, {
            signal: controller.signal,
          }),
        ]);
        if (responses.some((response) => !response.ok))
          throw new Error("Progress request failed.");
        const [streakPayload, missionPayload] = await Promise.all(
          responses.map((response) => response.json()),
        );
        if (!isCurrent()) return;
        const unavailable = [streakPayload, missionPayload].find(
          (payload) => payload?.disabled,
        );
        if (unavailable) {
          setServerDisabled({
            owner,
            message:
              typeof unavailable.message === "string"
                ? unavailable.message
                : CLIENT_ENV.GAMIFICATION_DISABLED_MESSAGE,
          });
          return;
        }
        const verified = parseMissionSummary(streakPayload, missionPayload);
        setSnapshot({ owner, summary: verified });
      } catch (cause) {
        if (isCurrent() && (cause as Error)?.name !== "AbortError")
          setFailure({ owner, message: "Could not load your progress." });
      } finally {
        if (isCurrent()) setLoading(false);
      }
    })();
    return () => {
      controller.abort();
      if (generation.current === request) generation.current += 1;
    };
  }, [owner, open, policy.enabled, version]);
  useEffect(() => {
    if (!policy.visible) setOpen(false);
  }, [policy.visible]);
  // The destination, not its trigger, confirms that Tasks actually opened with
  // usable progress for this owner. Hidden/disabled/error states never complete it.
  useEffect(() => {
    if (open && policy.visible && !disabled && summary && owner)
      completeFirstCareStep(owner, "tasks");
  }, [open, policy.visible, disabled, summary, owner]);

  if (!policy.visible) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        mobileMode="center"
        surface="soft"
        padding="none"
        hideCloseButton
        className="w-[94vw] max-w-md [--dialog-padding:16px]"
      >
        <DialogHeader className="space-y-2 pr-[68px]">
          <DialogTitle className="flex min-w-0 items-center gap-[8px] leading-snug">
            <Image
              src="/icons/Volcanic_Rock.svg"
              alt=""
              width={20}
              height={20}
              className="h-[20px] w-[20px] shrink-0"
              aria-hidden="true"
            />
            Farmer&apos;s Tasks
          </DialogTitle>
        </DialogHeader>
        <Button
          variant="headerIcon"
          size="icon"
          className="absolute right-[12px] top-[12px] h-[44px] min-h-[44px] w-[44px] min-w-[44px]"
          aria-label="Close Tasks"
          onClick={() => setOpen(false)}
        >
          <X className="h-4 w-4" />
        </Button>
        <DialogBody className="space-y-4 pr-1">
          <DialogDescription className="leading-relaxed">
            Earn up to 100 Rocks per day. Daily reset is 00:00 UTC.
          </DialogDescription>
          {disabled ? (
            <div
              role="status"
              className="rounded-[var(--radius-panel)] border border-border p-3.5"
            >
              <p className="text-sm font-semibold">
                Tasks are temporarily unavailable
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {disabledMessage ||
                  policy.message ||
                  CLIENT_ENV.GAMIFICATION_DISABLED_MESSAGE}
              </p>
            </div>
          ) : !owner ? (
            <p role="status" className="text-sm text-muted-foreground">
              Connect a supported EVM wallet to view your daily Tasks and saved
              progress.
            </p>
          ) : (
            <>
              <div
                className="space-y-3 rounded-[var(--radius-panel)] border border-border/60 bg-card p-3.5"
                data-task-summary-card
                aria-busy={loading || undefined}
              >
                {error && (
                  <div role="status" className="space-y-2 text-sm">
                    <p>
                      {error}{" "}
                      {summary
                        ? "Showing last verified progress."
                        : "Your progress is unknown until it loads."}
                    </p>
                    <Button
                      variant="outline"
                      size="compact"
                      className="h-auto max-w-full whitespace-normal leading-snug"
                      disabled={loading}
                      onClick={() => setVersion((value) => value + 1)}
                    >
                      {loading ? "Retrying progress…" : "Retry progress"}
                    </Button>
                  </div>
                )}
                {!error && loading && (
                  <p role="status" className="text-xs text-muted-foreground">
                    {summary
                      ? "Refreshing saved progress…"
                      : "Loading your progress…"}
                  </p>
                )}
                {notice?.owner === owner && (
                  <p role="status" className="text-xs text-muted-foreground">
                    {notice.message}
                  </p>
                )}
                <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,5rem),1fr))] gap-2">
                  <div>
                    <span className="text-xs text-muted-foreground">
                      Streak
                    </span>
                    <p className="text-xl font-semibold tabular-nums">
                      {summary?.streak.current ?? "—"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Best {summary?.streak.best ?? "—"}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">Today</span>
                    <p className="text-xl font-semibold tabular-nums">
                      {summary?.day.pts ?? "—"}
                      <span className="text-xs">/100</span>
                    </p>
                    <p className="text-xs text-muted-foreground">Rocks</p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">Tasks</span>
                    <p className="text-xl font-semibold tabular-nums">
                      {summary ? completed : "—"}
                      <span className="text-xs">/{totalTaskCount}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">Completed</p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Total Rocks: {summary?.total ?? "—"}
                </p>
                {summary && (
                  <ProgressBar
                    label="Daily task reward progress"
                    value={summary.day.pts}
                  />
                )}
              </div>
              {lastTask && (
                <p className="text-xs text-muted-foreground">
                  Last opened: {lastTask}
                </p>
              )}
              <div className="grid grid-cols-1 gap-3 pb-1">
                {sections.map((section) => (
                  <MissionCard
                    key={section.key}
                    section={section}
                    assets={assets}
                    onRetryAssets={retryAssets}
                    onNavigate={(task, action) => {
                      setLastTask(task.label);
                      setOpen(false);
                      const target = action?.target;
                      if (target?.kind === 'land') openMissionLand(target);
                      else if (target?.kind === 'plant') openMissionPlant(target);
                      else if (target?.kind === 'mint') navigateToGameTab('mint', { mintType: target.mintType });
                      else navigateToMission(task.destination);
                    }}
                  />
                ))}
              </div>
            </>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
