"use client";

import { useState } from "react";
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
  const { unreadCount, markAsRead } = useChat();

  // Only show chat button when wallet is connected
  if (!isConnected && !(isSolana && solanaAddress)) {
    return null;
  }

  const handleOpenChat = () => {
    setShowChat(true);
    markAsRead();
  };

  return (
    <>
      <Button
        variant="outline"
        size="icon"
        onClick={handleOpenChat}
        className={`relative ${className}`}
        title="Open Public Chat"
      >
        <Image
          src="/icons/chat.svg"
          alt="Chat"
          width={24}
          height={24}
          className="w-6 h-6"
        />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
          </span>
        )}
      </Button>

      {showChat && (
        <ChatDialog
          open={showChat}
          onOpenChange={setShowChat}
        />
      )}
    </>
  );
}
