"use client";

import { useState } from "react";
import { SignInWithBaseButton } from "@base-org/account-ui/react";
import Image from "next/image";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { AuthSurface } from "@/lib/auth-surface";
import { isSolanaAuthAvailable } from "@/lib/solana-auth-availability";

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

  if (!isSolanaAuthAvailable()) {
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
      fullWidth
      variant="special"
      onClick={handleClick}
      disabled={isProcessing}
      loading={isProcessing}
      loadingText="Loading..."
    >
      {/* No isProcessing branch: Button renders loadingText while loading, so these
          children are never shown in that state. */}
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
    </Button>
  );
}
