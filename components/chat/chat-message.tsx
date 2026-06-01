"use client";

import { useCallback, useState } from "react";
import { ChatMessage, AIChatMessage } from "@/lib/types";
import { differenceInSeconds, differenceInMinutes, differenceInHours, differenceInDays, differenceInWeeks, differenceInMonths, differenceInYears } from "date-fns";
import { useAccount } from "wagmi";
import { usePrimaryName } from "@/components/hooks/usePrimaryName";
import { Bot, User, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { postMissionProgress } from "@/lib/mission-tracking";
import { MessageResponse } from "@/components/ai-elements/message";
import ChatProfileDialog from "./chat-profile-dialog";

function formatRelativeShort(date: Date) {
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

function formatToolLabel(toolName: string): string {
  return toolName
    .replace(/^get_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function renderAIToolFooter(message: ChatMessage | AIChatMessage) {
  if (!('toolCalls' in message) || !message.toolCalls?.length) {
    return null;
  }

  const successfulTools = message.toolCalls.filter((trace) => trace.status === 'ok');
  if (!successfulTools.length) {
    return null;
  }

  const source = successfulTools.find((trace) => trace.source)?.source;
  const fetchedAt = successfulTools
    .map((trace) => trace.freshness?.fetchedAt)
    .find(Boolean);
  const toolLabels = Array.from(new Set(successfulTools.map((trace) => formatToolLabel(trace.toolName)))).slice(0, 3);

  return (
    <div className="mt-2 border-t border-blue-300/40 pt-2 text-[11px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">
      <span>Sources: {toolLabels.join(', ')}</span>
      {source && <span> - {source}</span>}
      {fetchedAt && <span> - {formatRelativeShort(new Date(fetchedAt))}</span>}
    </div>
  );
}

interface ChatMessageProps {
  message: ChatMessage | AIChatMessage;
  isAIMode?: boolean;
  'aria-setsize'?: number;
  'aria-posinset'?: number;
}

export default function ChatMessageComponent({
  message,
  isAIMode = false,
  'aria-setsize': ariaSetsize,
  'aria-posinset': ariaPosinset
}: ChatMessageProps) {
  const { address } = useAccount();
  
  const isAIMessage = isAIMode && 'type' in message && message.type === 'assistant';
  const isUserAIMessage = isAIMode && (('type' in message && message.type === 'user') || (message as UntypedValue).displayName === 'You');
  const isOwnPublicMessage = !isAIMode && address?.toLowerCase() === message.address.toLowerCase();
  
  const { name } = usePrimaryName(message.address);
  const [profileOpen, setProfileOpen] = useState(false);

  const trackProfileVisit = useCallback(() => {
    if (!address) return;
    postMissionProgress({ address, taskId: 's2_visit_profile' }).catch(() => {});
  }, [address]);
  
  let displayName = '';
  if (isAIMessage) {
    displayName = 'Neural Seed';
  } else if (isOwnPublicMessage || isUserAIMessage) {
    displayName = 'You';
  } else {
    displayName = name || `${message.address.slice(0, 6)}...${message.address.slice(-4)}`;
  }

  const alignment = isAIMessage || !isOwnPublicMessage && !isUserAIMessage ? 'justify-start' : 'justify-end';
  
  const bgColor = isAIMessage ? 'bg-blue-100 dark:bg-blue-900/30' :
                  isOwnPublicMessage || isUserAIMessage ? 'bg-primary text-primary-foreground' :
                  'bg-muted';
  const canOpenProfile = !isAIMessage && !isUserAIMessage && !isOwnPublicMessage;

  const displayNameNode = (
    <span className="text-xs font-semibold">
      {displayName}
    </span>
  );

  const profileTrigger = canOpenProfile ? (
    <button
      type="button"
      onClick={() => {
        setProfileOpen(true);
        trackProfileVisit();
      }}
      className="inline-flex items-center justify-center px-2 py-0.5 text-[10px] leading-none whitespace-nowrap rounded-md bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 btn-compact"
      aria-label={`Open profile for ${displayName}`}
    >
      Profile
    </button>
  ) : null;

  return (
    <>
      <div className={cn("flex", alignment)}>
        <div
          className={cn(
            "rounded-lg px-3 py-2 max-w-[85%] sm:max-w-[75%] min-w-0 [overflow-wrap:anywhere]",
            bgColor
          )}
          role="article"
          aria-label={`Message from ${displayName}`}
          aria-setsize={ariaSetsize}
          aria-posinset={ariaPosinset}
        >
          <div className="flex items-start justify-between gap-2 mb-1">
            <div className="flex flex-wrap items-center gap-1.5">
              {isAIMessage && <Bot className="w-4 h-4 text-blue-500" />}
              {(isUserAIMessage || isOwnPublicMessage) && <User className="w-4 h-4" />}
              {displayNameNode}
              {!isAIMessage && !isUserAIMessage && !isOwnPublicMessage && name && (
                <CheckCircle2 className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
              )}
              {profileTrigger}
            </div>
            <span className="text-xs text-muted-foreground whitespace-nowrap self-start">
              {formatRelativeShort(new Date(message.timestamp))}
            </span>
          </div>
          
          <div className="text-sm leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
            {isAIMessage ? (
              <MessageResponse
                className="prose prose-sm max-w-none dark:prose-invert prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-1 prose-a:break-all prose-code:break-all [overflow-wrap:anywhere]"
              >
                {message.message}
              </MessageResponse>
            ) : message.message}
          </div>
          {isAIMessage && renderAIToolFooter(message)}
          
        </div>
      </div>

      {canOpenProfile && (
        <ChatProfileDialog
          address={message.address}
          open={profileOpen}
          onOpenChange={setProfileOpen}
        />
      )}
    </>
  );
}
