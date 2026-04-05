"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAccount } from "wagmi";
import Image from "next/image";
import ChatDialog from "./chat-dialog";
import { useIsSolanaWallet, useSolanaWallet } from "@/components/solana";
import { useChat } from "./chat-context";

interface ChatButtonProps {
  className?: string;
}

export default function ChatButton({ className = "" }: ChatButtonProps) {
  const { isConnected } = useAccount();
  const isSolana = useIsSolanaWallet();
  const { solanaAddress } = useSolanaWallet();
  const [showChat, setShowChat] = useState(false);
  const { unreadCount, markAsRead, setChatOpen } = useChat();

  useEffect(() => {
    return () => {
      setChatOpen(false);
    };
  }, [setChatOpen]);

  // Only show chat button when wallet is connected
  if (!isConnected && !(isSolana && solanaAddress)) {
    return null;
  }

  const handleOpenChat = () => {
    setShowChat(true);
    setChatOpen(true);
    markAsRead();
  };

  const unreadLabel = unreadCount > 0
    ? `Open public chat, ${unreadCount} unread message${unreadCount === 1 ? '' : 's'}`
    : "Open public chat";

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={handleOpenChat}
        className={`relative ${className}`}
        title="Open Public Chat"
        aria-label={unreadLabel}
        aria-haspopup="dialog"
        aria-expanded={showChat}
      >
        <Image
          src="/icons/chat.svg"
          alt=""
          width={24}
          height={24}
          className="w-6 h-6"
          aria-hidden="true"
        />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-3 w-3" aria-hidden="true">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
          </span>
        )}
      </Button>

      {showChat && (
        <ChatDialog
          open={showChat}
          onOpenChange={(open) => {
            setShowChat(open);
            setChatOpen(open);
          }}
        />
      )}
    </>
  );
}
