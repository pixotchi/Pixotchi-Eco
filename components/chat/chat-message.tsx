"use client";

import { useState } from "react";
import { ChatMessage, AIChatMessage } from "@/lib/types";
import { differenceInSeconds, differenceInMinutes, differenceInHours, differenceInDays, differenceInWeeks, differenceInMonths, differenceInYears } from "date-fns";
import { useAccount } from "wagmi";
import { usePrimaryName } from "@/components/hooks/usePrimaryName";
import { Bot, User, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import ChatProfileDialog from "./chat-profile-dialog";

// Function to format AI messages with bold syntax **text**
function formatAIMessage(text: string) {
  const parts = text.split(/(\*\*.*?\*\*)/g);
  
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      // Remove the ** markers and make bold
      const boldText = part.slice(2, -2);
      return (
        <strong key={index} className="font-semibold">
          {boldText}
        </strong>
      );
    }
    return part;
  });
}

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
  
  const isAIMessage = isAIMode && (('type' in message && message.type === 'assistant') || (message as any).displayName === 'Agent');
  const isUserAIMessage = isAIMode && (('type' in message && message.type === 'user') || (message as any).displayName === 'You');
  const isOwnPublicMessage = !isAIMode && address?.toLowerCase() === message.address.toLowerCase();
  
  const { name } = usePrimaryName(message.address);
  const [profileOpen, setProfileOpen] = useState(false);
  
  let displayName = '';
  if (isAIMessage) {
    displayName = (message as any).displayName === 'Agent' ? 'Agent' : 'Neural Seed';
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
      onClick={() => setProfileOpen(true)}
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
            "rounded-lg px-3 py-2 max-w-[85%] sm:max-w-[75%]",
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
          
          <div className="text-sm leading-relaxed whitespace-pre-wrap break-words">
            {isAIMessage ? formatAIMessage(message.message) : message.message}
          </div>
          
          {isAIMessage && 'tokensUsed' in message && message.tokensUsed && process.env.NODE_ENV === 'development' && (
            <div className="text-xs text-blue-700 dark:text-blue-300 mt-1 opacity-70">
              {message.tokensUsed} tokens
            </div>
          )}
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
