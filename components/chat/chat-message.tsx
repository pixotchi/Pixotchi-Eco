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
import { Button } from "@/components/ui/button";
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
  
  const bgColor = isAIMessage ? 'border border-[hsl(var(--info)/0.22)] bg-[hsl(var(--info)/0.12)] text-foreground' :
                  isOwnPublicMessage || isUserAIMessage ? 'border border-primary/20 bg-primary bg-[image:var(--gradient-control-active)] text-primary-foreground shadow-[var(--shadow-hairline)]' :
                  'border border-border/50 bg-card/85 bg-[image:var(--gradient-surface)] text-foreground shadow-[var(--shadow-hairline)]';
  const bubbleSize = isAIMessage
    ? 'max-w-[92%] sm:max-w-[82%] px-4 py-3'
    : 'max-w-[85%] sm:max-w-[75%] px-3 py-2';
  const canOpenProfile = !isAIMessage && !isUserAIMessage && !isOwnPublicMessage;

  const displayNameNode = (
    <span className="text-xs font-semibold">
      {displayName}
    </span>
  );

  const profileTrigger = canOpenProfile ? (
    <Button
      type="button"
      onClick={() => {
        setProfileOpen(true);
        trackProfileVisit();
      }}
      variant="compactUtility"
      size="compact"
      className="h-6 min-h-6 rounded-md border-primary/25 bg-primary/5 px-2 py-0 text-[10px] text-primary shadow-none hover:bg-primary/10 active:translate-y-0 active:scale-100"
      aria-label={`Open profile for ${displayName}`}
    >
      Profile
    </Button>
  ) : null;

  return (
    <>
      <div className={cn("flex", alignment)}>
        <div
          className={cn(
            "min-w-0 rounded-[var(--radius-control)] [overflow-wrap:anywhere]",
            bubbleSize,
            bgColor
          )}
          role="article"
          aria-label={`Message from ${displayName}`}
          aria-setsize={ariaSetsize}
          aria-posinset={ariaPosinset}
        >
          <div className="flex items-start justify-between gap-2 mb-1">
            <div className="flex flex-wrap items-center gap-1.5">
              {isAIMessage && <Bot className="w-4 h-4 text-[hsl(var(--info))]" />}
              {(isUserAIMessage || isOwnPublicMessage) && <User className="w-4 h-4" />}
              {displayNameNode}
              {!isAIMessage && !isUserAIMessage && !isOwnPublicMessage && name && (
                <CheckCircle2 className="w-3.5 h-3.5 text-[hsl(var(--info))] flex-shrink-0" />
              )}
              {profileTrigger}
            </div>
            <span className="text-xs text-muted-foreground whitespace-nowrap self-start">
              {formatRelativeShort(new Date(message.timestamp))}
            </span>
          </div>
          
          <div
            className={cn(
              "text-sm leading-relaxed break-words [overflow-wrap:anywhere]",
              !isAIMessage && "whitespace-pre-wrap"
            )}
          >
            {isAIMessage ? (
              <MessageResponse
                className={cn(
                  "max-w-none text-sm leading-6 text-current [overflow-wrap:anywhere]",
                  "[&_*]:max-w-full",
                  "[&>p]:my-1.5 [&>p:first-child]:mt-0 [&>p:last-child]:mb-0",
                  "[&_h1]:mb-2 [&_h1]:mt-3 [&_h1]:text-lg [&_h1]:font-bold [&_h1]:leading-6",
                  "[&_h2]:mb-2 [&_h2]:mt-3 [&_h2]:text-base [&_h2]:font-bold [&_h2]:leading-6",
                  "[&_h3]:mb-1.5 [&_h3]:mt-2.5 [&_h3]:text-sm [&_h3]:font-bold [&_h3]:leading-5",
                  "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5",
                  "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5",
                  "[&_li]:pl-0 [&_li]:marker:text-current [&_li>p]:my-0",
                  "[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-current/30 [&_blockquote]:pl-3",
                  "[&_pre]:my-2 [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:p-2",
                  "[&_a]:break-words [&_code]:break-words [&_strong]:font-bold"
                )}
              >
                {message.message}
              </MessageResponse>
            ) : message.message}
          </div>
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
