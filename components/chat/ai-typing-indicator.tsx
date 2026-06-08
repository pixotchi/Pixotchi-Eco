"use client";

import { Bot } from "lucide-react";

export default function AITypingIndicator() {
  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      <div className="flex items-center gap-2 rounded-[var(--radius-control)] border border-border/50 bg-card/85 bg-[image:var(--gradient-surface)] px-3 py-2 shadow-[var(--shadow-hairline)]">
        <Bot className="w-4 h-4" />
        <span className="text-sm">Neural Seed is typing</span>
        <div className="flex gap-1">
          <div className="w-1 h-1 bg-current rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
          <div className="w-1 h-1 bg-current rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
          <div className="w-1 h-1 bg-current rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    </div>
  );
}
