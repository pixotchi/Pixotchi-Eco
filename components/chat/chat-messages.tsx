"use client";

import React, { useRef, useEffect, useState, useCallback } from "react";
import ChatMessageComponent from "./chat-message";
import ChatProfileDialog from "./chat-profile-dialog";
import { useChat } from "./chat-context";
import { BaseExpandedLoadingPageLoader } from "@/components/ui/loading";
import { Button } from "@/components/ui/button";
import { RefreshIcon } from "@/components/ui/refresh-icon";
import Image from "next/image";
import type { ChatMode } from "@/lib/types";

const SCROLL_THRESHOLD = 56;

type ChatMessagesProps = {
  modeOverride?: ChatMode;
};

export default function ChatMessages({ modeOverride }: ChatMessagesProps = {}) {
  const {
    messages,
    loading,
    mode,
    getLoadingForMode,
    getMessagesForMode,
    publicChatAddress,
    publicChatAuthenticated,
    publicChatLoading,
    publicChatState,
    retryPublicChatSession,
  } = useChat();
  const activeMode = modeOverride ?? mode;
  const activeMessages = modeOverride ? getMessagesForMode(modeOverride) : messages;
  const activeLoading = modeOverride ? getLoadingForMode(modeOverride) : loading;
  const isAssistantMode = activeMode === 'ai';
  const publicChatUnavailable =
    (activeMode === 'public' || activeMode === 'ai') && !publicChatAuthenticated;
  const isRefreshingSession = publicChatLoading || publicChatState === 'booting';
  const unavailableTitle = isAssistantMode ? 'Chat session unavailable' : 'Public chat unavailable';
  const unavailableDetail =
    publicChatLoading || publicChatState === 'booting'
      ? 'Restoring your secure chat session...'
      : publicChatState === 'error'
        ? 'We could not verify your chat session. Refresh, then try again.'
        : isAssistantMode
          ? 'Connect or refresh your secure session to chat with Neural Seed.'
          : 'Connect or refresh your secure session to join public chat.';
  const containerRef = useRef<HTMLDivElement>(null);
  const [stickToBottom, setStickToBottom] = useState(true);
  const touchActiveRef = useRef(false);
  const [unseenCount, setUnseenCount] = useState(0);
  const lastSeenLengthRef = useRef(0);
  // One dialog for the whole list: each row used to mount its own
  // ChatProfileDialog (50 dialog instances + caches for 50 messages).
  const [profileAddress, setProfileAddress] = useState<string | null>(null);
  const openProfile = useCallback((address: string) => setProfileAddress(address), []);
  // Slow clock so relative timestamps tick over (AI-mode messages used to stay
  // on "now" for the whole session).
  const [clockTick, setClockTick] = useState(0);
  useEffect(() => {
    const interval = window.setInterval(() => setClockTick((tick) => tick + 1), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  const handleScroll = useCallback(() => {
    const node = containerRef.current;
    if (!node) return;
    const isAtBottom = node.scrollHeight - node.scrollTop - node.clientHeight <= SCROLL_THRESHOLD;
    setStickToBottom(isAtBottom);
    if (isAtBottom) {
      lastSeenLengthRef.current = activeMessagesRef.current.length;
      setUnseenCount(0);
    }
  }, []);

  const activeMessagesRef = useRef(activeMessages);
  activeMessagesRef.current = activeMessages;

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    if (stickToBottom) {
      // Don't fight an in-progress touch fling with a hard scrollTop write.
      if (!touchActiveRef.current) {
        node.scrollTop = node.scrollHeight;
      }
      lastSeenLengthRef.current = activeMessages.length;
      setUnseenCount(0);
      return;
    }
    // Scrolled up: surface how many messages arrived below the fold.
    setUnseenCount(Math.max(0, activeMessages.length - lastSeenLengthRef.current));
  }, [activeMessages, stickToBottom]);

  const jumpToLatest = useCallback(() => {
    const node = containerRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
    lastSeenLengthRef.current = activeMessagesRef.current.length;
    setUnseenCount(0);
    setStickToBottom(true);
  }, []);

  if (activeLoading && activeMessages.length === 0) {
    return (
      <div ref={containerRef} className="surface-scroll-fade h-full overflow-y-auto" onScroll={handleScroll}>
        <div className="flex items-center justify-center h-full">
          <BaseExpandedLoadingPageLoader text="Loading messages..." />
        </div>
      </div>
    );
  }

  if (activeMessages.length === 0) {
    return (
      <div ref={containerRef} className="surface-scroll-fade h-full overflow-y-auto" onScroll={handleScroll}>
        <div className="flex flex-col items-center justify-center h-full text-center p-4">
          {publicChatUnavailable ? (
            <div
              className="max-w-sm rounded-[var(--radius-panel)] border border-[hsl(var(--warning)/0.32)] bg-[hsl(var(--warning)/0.10)] px-4 py-4 text-left shadow-[var(--shadow-hairline)]"
              role="status"
              aria-live="polite"
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-[var(--radius-control)] bg-[hsl(var(--warning)/0.18)]">
                  <Image src="/icons/chat-icon.webp" alt="" width={18} height={18} className="h-[18px] w-[18px]" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <h3 className="font-semibold text-foreground">
                    {unavailableTitle}
                  </h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {unavailableDetail}
                  </p>
                  <Button
                    type="button"
                    variant="warning"
                    size="sm"
                    className="mt-3"
                    aria-busy={isRefreshingSession || undefined}
                    disabled={isRefreshingSession}
                    onClick={retryPublicChatSession}
                  >
                    <RefreshIcon refreshing={isRefreshingSession} className="h-4 w-4" />
                    {isRefreshingSession ? 'Refreshing...' : 'Refresh session'}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="mb-4">
                {isAssistantMode ? (
                  <Image
                    src="/icons/neuralseed.png"
                    alt="Neural Seed"
                    width={48}
                    height={48}
                    className="opacity-60"
                  />
                ) : (
                  <Image
                    src="/icons/chat-icon.webp"
                    alt="Chat"
                    width={48}
                    height={48}
                    className="opacity-60"
                  />
                )}
              </div>
              <h3 className="font-semibold text-foreground mb-1">
                {isAssistantMode ? 'Ask Neural Seed!' : 'Welcome to the chat!'}
              </h3>
              <p className="text-sm text-muted-foreground">
                {isAssistantMode
                  ? 'I can read live game data, explain mechanics, and help with your stats.'
                  : 'Be the first to start the conversation!'}
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-0">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        onTouchStart={() => { touchActiveRef.current = true; }}
        onTouchEnd={() => { touchActiveRef.current = false; }}
        onTouchCancel={() => { touchActiveRef.current = false; }}
        className="surface-scroll-fade h-full overflow-y-auto"
      >
        <div
          className="p-4 space-y-4"
          role="log"
          aria-label={`${isAssistantMode ? 'Assistant conversation' : 'Chat'} messages`}
          aria-live={isAssistantMode ? "polite" : "off"}
          aria-atomic="false"
        >
          {activeMessages.map((message, index) => (
            <ChatMessageComponent
              key={message.id}
              message={message}
              isAIMode={isAssistantMode}
              ownAddress={publicChatAddress}
              clockTick={clockTick}
              onOpenProfile={openProfile}
              aria-setsize={activeMessages.length}
              aria-posinset={index + 1}
            />
          ))}
        </div>
      </div>

      {/* Scrolled-up affordance: new arrivals used to be invisible. */}
      {!stickToBottom && unseenCount > 0 && (
        <Button
          type="button"
          size="touchCompact"
          variant="secondary"
          onClick={jumpToLatest}
          className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full shadow-[var(--shadow-raised)]"
        >
          {unseenCount === 1 ? '1 new message' : `${unseenCount} new messages`} ↓
        </Button>
      )}

      {profileAddress && (
        <ChatProfileDialog
          address={profileAddress}
          open
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setProfileAddress(null);
          }}
        />
      )}
    </div>
  );
}
