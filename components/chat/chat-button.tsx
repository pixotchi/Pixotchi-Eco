"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useAccount } from "wagmi";
import Image from "next/image";
import ChatDialog from "./chat-dialog";

interface ChatButtonProps {
  className?: string;
}

export default function ChatButton({ className = "" }: ChatButtonProps) {
  const { isConnected } = useAccount();
  const [showChat, setShowChat] = useState(false);

  // Only show chat button when wallet is connected
  if (!isConnected) {
    return null;
  }

  return (
    <>
      <Button
        variant="outline"
        size="icon"
        onClick={() => setShowChat(true)}
        className={className}
        title="Open Public Chat"
      >
        <Image 
          src="/icons/chat.svg" 
          alt="Chat" 
          width={24} 
          height={24}
          className="w-6 h-6"
        />
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
