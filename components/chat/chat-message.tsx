"use client";

import { ChatMessage, AIChatMessage } from "@/lib/types";
import { formatDistanceToNow } from "date-fns";
import { useAccount } from "wagmi";
import { useName } from "@coinbase/onchainkit/identity";
import { base } from "viem/chains";
import { Bot, User } from "lucide-react";
import { cn } from "@/lib/utils";

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
  const isCastShare = 'type' in message && (message as ChatMessage).type === 'cast_share' && (message as ChatMessage).castData;
  
  const { data: name } = useName({
    address: message.address as `0x${string}` ?? "0x0000000000000000000000000000000000000000",
    chain: base,
  });
  
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

  // Render cast share embed
  if (isCastShare) {
    const chatMsg = message as ChatMessage;
    const castData = chatMsg.castData!;
    
    return (
      <div className="flex flex-col gap-2 w-full">
        {/* Sharer info */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <User className="w-3 h-3" />
          <span className="font-semibold">{displayName}</span>
          <span>shared a cast</span>
          <span>•</span>
          <span>{formatDistanceToNow(new Date(message.timestamp), { addSuffix: true })}</span>
        </div>
        
        {/* Cast embed card */}
        <div className="border border-border rounded-lg p-3 bg-card/50 backdrop-blur-sm max-w-[90%]">
          {/* Cast author */}
          <div className="flex items-center gap-2 mb-2">
            {castData.author.pfpUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img 
                src={castData.author.pfpUrl} 
                alt={castData.author.displayName || 'User'} 
                className="w-8 h-8 rounded-full"
              />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold truncate">
                {castData.author.displayName || castData.author.username || `FID ${castData.author.fid}`}
              </p>
              {castData.author.username && (
                <p className="text-xs text-muted-foreground">@{castData.author.username}</p>
              )}
            </div>
          </div>
          
          {/* Cast text */}
          {castData.text && (
            <p className="text-sm whitespace-pre-wrap break-words mb-2">
              {castData.text}
            </p>
          )}
          
          {/* Channel info */}
          {castData.channelKey && (
            <p className="text-xs text-muted-foreground mb-1">
              /{castData.channelKey}
            </p>
          )}
          
          {/* Cast hash (clickable link to Warpcast) */}
          <a 
            href={`https://warpcast.com/~/conversations/${castData.hash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary hover:underline font-mono"
          >
            View on Warpcast →
          </a>
        </div>
      </div>
    );
  }

  // Regular message rendering
  return (
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
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="flex items-center gap-1.5">
            {isAIMessage && <Bot className="w-4 h-4 text-blue-500" />}
            {(isUserAIMessage || isOwnPublicMessage) && <User className="w-4 h-4" />}
            <span className="text-xs font-semibold">
              {displayName}
            </span>
          </div>
          <span className="text-xs text-muted-foreground">
            {formatDistanceToNow(new Date(message.timestamp), { addSuffix: true })}
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
  );
}
