"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAccount } from "wagmi";
import Image from "next/image";
import dynamic from "next/dynamic";
import { useIsSolanaWallet, useSolanaWallet } from "@/components/solana";
import { useChatHeader } from "./chat-view-context";
import { onPublicChatOpen } from "@/lib/mission-navigation";

const ChatDialog = dynamic(() => import("./chat-dialog"), {
  ssr: false,
});

interface ChatButtonProps {
  className?: string;
}

export default function ChatButton({ className = "" }: ChatButtonProps) {
  const { isConnected } = useAccount();
  const isSolana = useIsSolanaWallet();
  const { solanaAddress } = useSolanaWallet();
  const [showChat, setShowChat] = useState(false);
  const [hasOpenedChat, setHasOpenedChat] = useState(false);
  const [highlightUnread, setHighlightUnread] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { unreadCount, setChatOpen, setMode } = useChatHeader();
  const previousUnreadCountRef = useRef(unreadCount);
  const unreadSignalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const hasNewUnread = unreadCount > previousUnreadCountRef.current;
    previousUnreadCountRef.current = unreadCount;

    if (unreadCount === 0 || showChat) {
      if (unreadSignalTimerRef.current) clearTimeout(unreadSignalTimerRef.current);
      unreadSignalTimerRef.current = null;
      setHighlightUnread(false);
      return;
    }

    // Signal a new arrival once. More messages during the same burst do not
    // restart or extend it; the static unread badge remains afterward.
    if (hasNewUnread && unreadSignalTimerRef.current === null) {
      setHighlightUnread(true);
      unreadSignalTimerRef.current = setTimeout(() => {
        unreadSignalTimerRef.current = null;
        setHighlightUnread(false);
      }, 900);
    }
  }, [showChat, unreadCount]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
      }
      if (unreadSignalTimerRef.current) {
        clearTimeout(unreadSignalTimerRef.current);
      }
      setChatOpen(false);
    };
  }, [setChatOpen]);

  const handleOpenChat = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setHasOpenedChat(true);
    setShowChat(true);
    setChatOpen(true);
  }, [setChatOpen]);

  useEffect(() => onPublicChatOpen(() => {
    if (!isConnected && !(isSolana && solanaAddress)) return;
    setMode('public');
    handleOpenChat();
  }), [handleOpenChat, isConnected, isSolana, setMode, solanaAddress]);

  if (!isConnected && !(isSolana && solanaAddress)) return null;

  const unreadLabel = unreadCount > 0
    ? `Open public chat, ${unreadCount} unread message${unreadCount === 1 ? '' : 's'}`
    : "Open public chat";

  return (
    <>
      <Button
        type="button"
        variant="headerIcon"
        size="headerIcon"
        onClick={handleOpenChat}
        className={`relative [&>img]:h-[24px] [&>img]:w-[24px] ${className}`}
        title="Open Public Chat"
        aria-label={unreadLabel}
        aria-haspopup="dialog"
        aria-expanded={showChat}
      >
        <Image
          src="/icons/chat-icon.webp"
          alt=""
          width={24}
          height={24}
          className="h-6 w-6"
          aria-hidden="true"
          preload
        />
        {unreadCount > 0 && (
          <span className="absolute -top-[4px] -right-[4px] flex h-[12px] w-[12px]" aria-hidden="true">
            <span className={`absolute -inset-1 rounded-full border-2 border-[hsl(0_84%_60%)] transition-opacity duration-[var(--motion-quick)] ease-[var(--ease-standard)] ${highlightUnread ? 'opacity-75' : 'opacity-0'}`}></span>
            <span className="relative inline-flex h-[12px] w-[12px] rounded-full bg-[hsl(0_84%_60%)]"></span>
          </span>
        )}
      </Button>

      {hasOpenedChat && (
        <ChatDialog
          open={showChat}
          onOpenChange={(open) => {
            setShowChat(open);
            if (open) {
              if (closeTimerRef.current) {
                clearTimeout(closeTimerRef.current);
                closeTimerRef.current = null;
              }
              setChatOpen(true);
              return;
            }

            closeTimerRef.current = setTimeout(() => {
              closeTimerRef.current = null;
              setChatOpen(false);
            }, 260);
          }}
        />
      )}
    </>
  );
}
