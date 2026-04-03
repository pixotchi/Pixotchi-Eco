"use client";

import { useState } from "react";
import { SignInWithBaseButton } from "@base-org/account-ui/react";
import Image from "next/image";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { AuthSurface } from "@/lib/auth-surface";

type SurfaceSwitchButtonProps = {
  onSwitchSurface: (surface: AuthSurface) => Promise<void>;
};

export function BaseAccountSurfaceButton({
  onSwitchSurface,
}: SurfaceSwitchButtonProps) {
  const [isProcessing, setIsProcessing] = useState(false);

  const handleClick = () => {
    if (isProcessing) {
      return;
    }

    setIsProcessing(true);
    void (async () => {
      try {
        await onSwitchSurface("base");
      } catch (error) {
        console.error("Failed to switch to Base surface:", error);
        toast.error("Failed to switch to Base sign-in. Please try again.");
        setIsProcessing(false);
      }
    })();
  };

  return (
    <SignInWithBaseButton
      align="center"
      variant="solid"
      colorScheme="light"
      onClick={handleClick}
    />
  );
}

export function SolanaSurfaceButton({
  onSwitchSurface,
}: SurfaceSwitchButtonProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const isSolanaEnabled = process.env.NEXT_PUBLIC_SOLANA_ENABLED === "true";

  if (!isSolanaEnabled) {
    return null;
  }

  const handleClick = () => {
    if (isProcessing) {
      return;
    }

    setIsProcessing(true);
    void (async () => {
      try {
        await onSwitchSurface("privysolana");
      } catch (error) {
        console.error("Failed to switch to Solana surface:", error);
        toast.error("Failed to switch to Solana sign-in. Please try again.");
        setIsProcessing(false);
      }
    })();
  };

  return (
    <Button
      className="w-full rounded-md text-base font-semibold text-white h-11 bg-gradient-to-r from-[#9945FF] to-[#14F195] hover:from-[#8833EE] hover:to-[#0DE084] active:from-[#9945FF] active:to-[#14F195] focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
      variant="default"
      onClick={handleClick}
      disabled={isProcessing}
    >
      {isProcessing ? (
        "Loading…"
      ) : (
        <span className="flex items-center gap-2">
          <Image
            src="/icons/solana.svg"
            alt="Solana"
            width={20}
            height={20}
            className="w-5 h-5"
          />
          Continue with Solana
        </span>
      )}
    </Button>
  );
}
