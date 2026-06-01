"use client";

import React, { useRef, useEffect, useState, useCallback } from "react";
import ChatMessageComponent from "./chat-message";
import { useChat } from "./chat-context";
import { BaseExpandedLoadingPageLoader } from "@/components/ui/loading";
import Image from "next/image";
import type { ChatMode } from "@/lib/types";

const SCROLL_THRESHOLD = 56;

type ChatMessagesProps = {
  modeOverride?: ChatMode;
};

export default function ChatMessages({ modeOverride }: ChatMessagesProps = {}) {
  const { messages, loading, mode, getLoadingForMode, getMessagesForMode } = useChat();
  const activeMode = modeOverride ?? mode;
  const activeMessages = modeOverride ? getMessagesForMode(modeOverride) : messages;
  const activeLoading = modeOverride ? getLoadingForMode(modeOverride) : loading;
  const isAssistantMode = activeMode === 'ai';
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
            {isAssistantMode ? 'Ask Neural Seed AI!' : 'Welcome to the chat!'}
          </h3>
          <p className="text-sm text-muted-foreground">
            {isAssistantMode 
              ? 'I can read live game data, explain mechanics, and help with your stats.' 
              : 'Be the first to start the conversation!'}
          </p>
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
