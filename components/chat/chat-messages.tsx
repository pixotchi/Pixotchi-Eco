"use client";

import React, { useRef, useEffect, useState, useCallback } from "react";
import ChatMessageComponent from "./chat-message";
import { useChat } from "./chat-context";
import { BaseExpandedLoadingPageLoader } from "@/components/ui/loading";
import { Button } from "@/components/ui/button";
import Image from "next/image";
import type { ChatMode } from "@/lib/types";
import { AlertCircle, RefreshCw } from "lucide-react";

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
  const unavailableTitle = isAssistantMode ? 'Chat session unavailable' : 'Public chat unavailable';
  const unavailableDetail =
    publicChatLoading || publicChatState === 'booting'
      ? 'Restoring your secure chat session...'
      : publicChatState === 'error'
        ? 'We could not verify your chat session. Refresh or reconnect, then try again.'
        : isAssistantMode
          ? 'Connect or refresh your secure session to chat with Neural Seed.'
          : 'Connect or refresh your secure session to join public chat.';
  const containerRef = useRef<HTMLDivElement>(null);
  const [stickToBottom, setStickToBottom] = useState(true);

  const handleScroll = useCallback(() => {
    const node = containerRef.current;
    if (!node) return;
    const isAtBottom = node.scrollHeight - node.scrollTop - node.clientHeight <= SCROLL_THRESHOLD;
    setStickToBottom(isAtBottom);
  }, []);

  useEffect(() => {
    const node = containerRef.current;
    if (!node || !stickToBottom) return;
    node.scrollTop = node.scrollHeight;
  }, [activeMessages, stickToBottom]);

  if (activeLoading && activeMessages.length === 0) {
    return (
      <div ref={containerRef} className="h-full overflow-y-auto" onScroll={handleScroll}>
        <div className="flex items-center justify-center h-full">
          <BaseExpandedLoadingPageLoader text="Loading messages..." />
        </div>
      </div>
    );
  }

  if (activeMessages.length === 0) {
    return (
      <div ref={containerRef} className="h-full overflow-y-auto" onScroll={handleScroll}>
        <div className="flex flex-col items-center justify-center h-full text-center p-4">
          {publicChatUnavailable ? (
            <div
              className="max-w-sm rounded-[var(--radius-panel)] border border-[hsl(var(--warning)/0.32)] bg-[hsl(var(--warning)/0.10)] px-4 py-4 text-left shadow-[var(--shadow-hairline)]"
              role="status"
              aria-live="polite"
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-[var(--radius-control)] bg-[hsl(var(--warning)/0.18)] text-[hsl(var(--warning-foreground))]">
                  <AlertCircle className="h-4 w-4" aria-hidden="true" />
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
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    loading={publicChatLoading}
                    loadingText="Refreshing..."
                    onClick={retryPublicChatSession}
                  >
                    <RefreshCw className="h-4 w-4" aria-hidden="true" />
                    Refresh session
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
                    src="/icons/chat.svg"
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
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="h-full overflow-y-auto"
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
            aria-setsize={activeMessages.length}
            aria-posinset={index + 1}
          />
        ))}
      </div>
    </div>
  );
}
