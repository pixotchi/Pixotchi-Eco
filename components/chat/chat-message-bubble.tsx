"use client";
import { Bot, User } from 'lucide-react';
import dynamic from 'next/dynamic';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
const MessageResponse = dynamic(
  () => import("@/components/ai-elements/message").then((mod) => mod.MessageResponse),
  {
    loading: () => <span className="text-sm leading-6 text-current">Loading response...</span>,
    ssr: false,
  }
);


export function ChatMessageBubble({ content, displayName, kind, relativeTime, timestamp, onOpenProfile, ariaSetsize, ariaPosinset, deliveryStatus }: {
  content: string; displayName: string; kind: 'own' | 'other' | 'assistant'; relativeTime: string; timestamp?: string;
  onOpenProfile?: () => void; ariaSetsize?: number; ariaPosinset?: number;
  deliveryStatus?: 'failed' | 'cancelled';
}) {
  const isAIMessage = kind === 'assistant';
  const isOwn = kind === 'own';
  const alignment = isAIMessage || !isOwn ? 'justify-start' : 'justify-end';

  const bgColor = isOwn
    ? 'bg-primary text-primary-foreground'
    : 'surface-lifted border border-[hsl(var(--info)/0.24)] bg-card/95 bg-[image:var(--gradient-surface)] text-foreground shadow-[var(--shadow-hairline)]';
  const bubbleSize = isAIMessage
    ? 'max-w-[92%] sm:max-w-[82%] px-4 py-3'
    : 'max-w-[85%] sm:max-w-[75%] px-3 py-2';
  const canOpenProfile = !isAIMessage && !isOwn && Boolean(onOpenProfile);
  const timestampColor = isOwn
    ? 'text-primary-foreground'
    : 'text-muted-foreground';

  const displayNameNode = (
    <span className="min-w-0 text-xs font-semibold">
      {displayName}
    </span>
  );

  const profileTrigger = canOpenProfile ? (
    <Button
      type="button"
      onClick={() => {
        onOpenProfile?.();
      }}
      variant="outline"
      size="compact"
      className="h-6 min-h-6 min-w-11 shrink-0 rounded-md px-2 py-0 text-xs active:translate-y-0 active:scale-100"
      aria-label={`Open profile for ${displayName}`}
    >
      Profile
    </Button>
  ) : null;

  return (
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
        <div className="mb-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {isAIMessage && <Bot className="w-4 h-4 text-info-strong" />}
            {isOwn && <User className="w-4 h-4" />}
            {displayNameNode}
            {/* No check icon next to resolved names any more: a blue check next
                to a name reads as "verified account", but it only meant an
                ENS/Basename lookup succeeded. */}
            {profileTrigger}
          </div>
          <time dateTime={timestamp} title={timestamp} className={cn("text-xs whitespace-nowrap", timestampColor)}>
            {relativeTime}
          </time>
        </div>

        {deliveryStatus && <p className="mb-2 text-xs font-semibold" role="status">
          {deliveryStatus === 'failed' ? 'Response failed.' : 'Response stopped.'} Your question is saved in the input below. Send it again to retry.
        </p>}
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
              {content}
            </MessageResponse>
          ) : content}
        </div>
      </div>
    </div>
  );
}
