"use client";

import React, { useCallback, useMemo } from "react";
import { ChatMessage, AIChatMessage } from "@/lib/types";
import { differenceInSeconds, differenceInMinutes, differenceInHours, differenceInDays, differenceInWeeks, differenceInMonths, differenceInYears } from "date-fns";
import { useAccount } from "wagmi";
import { usePrimaryName } from "@/components/hooks/usePrimaryName";
import { formatAddress } from "@/lib/utils";
import { postMissionProgress } from "@/lib/mission-tracking";
import { ChatMessageBubble } from "./chat-message-bubble";

function formatRelativeShort(date: Date) {
  if (!Number.isFinite(date.getTime())) return 'Time unavailable';
  const now = new Date();
  const totalSeconds = Math.max(0, differenceInSeconds(now, date));

  if (totalSeconds < 10) return 'now';
  if (totalSeconds < 60) return `${Math.floor(totalSeconds)}s ago`;

  const minutes = differenceInMinutes(now, date);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = differenceInHours(now, date);
  if (hours < 24) return `${hours}h ago`;

  const days = differenceInDays(now, date);
  if (days < 7) return `${days}d ago`;

  const weeks = differenceInWeeks(now, date);
  if (weeks < 5) return `${weeks}w ago`;

  const months = differenceInMonths(now, date);
  if (months < 12) return `${months}mo ago`;

  const years = differenceInYears(now, date);
  return `${years}y ago`;
}

interface ChatMessageProps {
  message: ChatMessage | AIChatMessage;
  isAIMode?: boolean;
  /**
   * The viewer's CHAT identity (publicChatAddress), passed down by the list.
   * Comparing against the raw wagmi address broke own-message alignment for
   * Solana-bridge users, whose chat identity is a different address.
   */
  ownAddress?: string | null;
  /** Bumped by the list every ~30s so relative timestamps tick over. */
  clockTick?: number;
  onOpenProfile?: (address: string) => void;
  'aria-setsize'?: number;
  'aria-posinset'?: number;
}

/*
 * React.memo: this row used to be a plain function component, so every provider
 * tick (streaming updates arrive every ~60ms) re-ran up to 50 rows x 7 date-fns
 * calls. Now only the row whose message object actually changed re-renders,
 * plus a whole-list pass at most twice a minute for the clock tick.
 */
function ChatMessageComponent({
  message,
  isAIMode = false,
  ownAddress = null,
  clockTick = 0,
  onOpenProfile,
  'aria-setsize': ariaSetsize,
  'aria-posinset': ariaPosinset
}: ChatMessageProps) {
  const { address } = useAccount();

  const isAIMessage = isAIMode && 'type' in message && message.type === 'assistant';
  const isUserAIMessage = isAIMode && (('type' in message && message.type === 'user') || ('displayName' in message && message.displayName === 'You'));
  const isOwnPublicMessage = !isAIMode && !!ownAddress && ownAddress.toLowerCase() === message.address.toLowerCase();

  const { name } = usePrimaryName(message.address);

  const trackProfileVisit = useCallback(() => {
    if (!address) return;
    postMissionProgress({ address, taskId: 's2_visit_profile' }).catch(() => {});
  }, [address]);

  // Memoized on timestamp + the list's slow clock tick, instead of recomputing
  // seven date-fns differences on every render.
  const relativeTime = useMemo(
    () => formatRelativeShort(new Date(message.timestamp)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [message.timestamp, clockTick],
  );

  let displayName = '';
  if (isAIMessage) {
    displayName = 'Neural Seed';
  } else if (isOwnPublicMessage || isUserAIMessage) {
    displayName = 'You';
  } else {
    displayName = name || formatAddress(message.address);
  }

  const timestamp = new Date(message.timestamp);
  return <ChatMessageBubble content={message.message} displayName={displayName}
    kind={isAIMessage ? 'assistant' : isOwnPublicMessage || isUserAIMessage ? 'own' : 'other'}
    relativeTime={relativeTime} timestamp={Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : undefined}
    ariaSetsize={ariaSetsize} ariaPosinset={ariaPosinset}
    onOpenProfile={onOpenProfile ? () => { onOpenProfile(message.address); trackProfileVisit(); } : undefined} />;
}

export default React.memo(ChatMessageComponent);
