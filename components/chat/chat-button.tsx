"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAccount } from "wagmi";
import Image from "next/image";
import dynamic from "next/dynamic";
import { useIsSolanaWallet, useSolanaWallet } from "@/components/solana";
import { useChat } from "./chat-context";

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
        variant="headerIcon"
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
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[hsl(0_84%_60%)] opacity-75"></span>
            <span className="relative inline-flex h-3 w-3 rounded-full bg-[hsl(0_84%_60%)]"></span>
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
