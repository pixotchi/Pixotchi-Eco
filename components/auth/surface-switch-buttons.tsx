"use client";

import { useState } from "react";
import { SignInWithBaseButton } from "@base-org/account-ui/react";
import Image from "next/image";
import { useTheme } from "next-themes";
import toast from "react-hot-toast";
import { Loader2 } from "lucide-react";
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
  const { theme } = useTheme();
  // The vendor button only ships light/dark schemes; "dark" is the one
  // non-light app theme (this was hardcoded to light against all 8 themes).
  const colorScheme = theme === "dark" ? "dark" : "light";

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
      } finally {
        // Reset on success too: the flag used to stay true forever if the
        // switch resolved without unmounting this button, leaving it inert.
        setIsProcessing(false);
      }
    })();
  };

  return (
    <div
      className={isProcessing ? "pointer-events-none opacity-70" : undefined}
      aria-busy={isProcessing || undefined}
    >
      {/* Visible pending feedback — the vendor button has no loading state of
          its own, so the switch used to give no signal at all. */}
      {isProcessing ? (
        <div className="flex min-h-11 items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Connecting to Base...
        </div>
      ) : (
        <SignInWithBaseButton
          align="center"
          variant="solid"
          colorScheme={colorScheme}
          onClick={handleClick}
        />
      )}
    </div>
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
      } finally {
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
