"use client";

import React, { useRef, useEffect } from "react";
import ChatMessageComponent from "./chat-message";
import { useChat } from "./chat-context";
import { BaseExpandedLoadingPageLoader } from "@/components/ui/loading";
import Image from "next/image";

export default function ChatMessages() {
  const { messages, loading, mode } = useChat();
  const isAssistantMode = mode === 'ai' || mode === 'agent';
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (loading && messages.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <BaseExpandedLoadingPageLoader text="Loading messages..." />
      </div>
    );
  }

  if (messages.length === 0) {
    return (
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
          {isAssistantMode ? 'Ask the Neural Seed Agent or Assistant!' : 'Welcome to the chat!'}
        </h3>
        <p className="text-sm text-muted-foreground">
          {isAssistantMode 
            ? 'I can help with minting, game mechanics, your stats, and more.' 
            : 'Be the first to start the conversation!'}
        </p>
      </div>
    );
  }

  return (
    <div
      className="p-4 space-y-4"
      role="log"
      aria-label={`${isAssistantMode ? 'Assistant conversation' : 'Chat'} messages`}
      aria-live={isAssistantMode ? "polite" : "off"}
      aria-atomic="false"
    >
      {messages.map((message, index) => (
        <ChatMessageComponent
          key={message.id}
          message={message}
          isAIMode={isAssistantMode}
          aria-setsize={messages.length}
          aria-posinset={index + 1}
        />
      ))}
      <div ref={messagesEndRef} aria-hidden="true" />
    </div>
  );
}
