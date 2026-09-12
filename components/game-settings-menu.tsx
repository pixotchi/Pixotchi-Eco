"use client";

import { createRetryableDialog } from '@/components/retryable-dialog';
import { useRef, useState } from "react";
import { BookOpen, Info, MessageCircle, PlayCircle, Radio } from "lucide-react";
import { MenuSwitchItem, ThemeSelector } from "@/components/theme-selector";
import { usePerformanceMode } from "@/components/ui/performance-mode";
import { useIsSolanaWallet } from "@/components/solana";
import { useSlideshow } from "@/components/tutorial";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { openExternalUrl } from "@/lib/open-external";
import { setDialogOpener } from "@/lib/dialog-focus";
import { useEthMode } from "@/lib/eth-mode-context";
import { useSmartWallet } from "@/lib/smart-wallet-context";
import { useSensoryPreferences, setSensoryPreference } from '@/lib/sensory-feedback';
import packageJson from "@/package.json";

const FeedbackDialog = createRetryableDialog(() => import('@/components/feedback-dialog'), 'Share Your Feedback');
const actionClassName = "gap-3 px-3 font-medium";

const XBrandIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="currentColor" role="img" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z" />
  </svg>
);

const TelegramBrandIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="#26A5E4" role="img" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
  </svg>
);

const FarcasterBrandIcon = ({ className }: { className?: string }) => (
  <svg className={className} role="img" viewBox="0 0 1000 1000" aria-hidden="true">
    <path d="M257.778 155.556H742.222V844.445H671.111V528.889H670.414C662.554 441.677 589.258 373.333 500 373.333C410.742 373.333 337.446 441.677 329.586 528.889H328.889V844.445H257.778V155.556Z" fill="#855DCD" />
    <path d="M128.889 253.333L157.778 351.111H182.222V746.667C169.949 746.667 160 756.616 160 768.889V795.556H155.556C143.283 795.556 133.333 805.505 133.333 817.778V844.445H382.222V817.778C382.222 805.505 372.273 795.556 360 795.556H355.556V768.889C355.556 756.616 345.606 746.667 333.333 746.667H306.667V253.333H128.889Z" fill="#855DCD" />
    <path d="M675.556 746.667C663.283 746.667 653.333 756.616 653.333 768.889V795.556H648.889C636.616 795.556 626.667 805.505 626.667 817.778V844.445H875.556V817.778C875.556 805.505 865.606 795.556 853.333 795.556H848.889V768.889C848.889 756.616 838.94 746.667 826.667 746.667V351.111H851.111L880 253.333H702.222V746.667H675.556Z" fill="#855DCD" />
  </svg>
);

export function GameSettingsMenu({ onAbout }: { onAbout: () => void }) {
  const sensory = useSensoryPreferences();
  const { start, enabled } = useSlideshow();
  const { isEthMode, toggleEthMode, isFeatureEnabled: ethModeFeatureEnabled } = useEthMode();
  const { isSmartWallet } = useSmartWallet();
  const isSolana = useIsSolanaWallet();
  const { enabled: performanceModeEnabled, setEnabled: setPerformanceModeEnabled } = usePerformanceMode();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pendingDialogRef = useRef<(() => void) | null>(null);
  const [feedbackOpened, setFeedbackOpened] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  // Transfer focus through the persistent trigger before opening a dialog.
  // Menu items unmount on selection and cannot serve as dialog return targets.
  const handleMenuCloseAutoFocus = (event: Event) => {
    const openDialog = pendingDialogRef.current;
    if (!openDialog) return;
    pendingDialogRef.current = null;
    event.preventDefault();
    if (triggerRef.current) {
      triggerRef.current.focus({ preventScroll: true });
      setDialogOpener(triggerRef.current);
    }
    openDialog();
  };

  return (
    <>
      <ThemeSelector triggerRef={triggerRef} onCloseAutoFocus={handleMenuCloseAutoFocus}>
        {ethModeFeatureEnabled && (isSmartWallet || isSolana) && (
          <MenuSwitchItem
            label="ETH Mode"
            description="Pay with ETH for supported SEED purchases"
            checked={isEthMode}
            onCheckedChange={toggleEthMode}
          />
        )}
        <MenuSwitchItem
          label="Performance Mode"
          description="Disable effects and animations"
          checked={performanceModeEnabled}
          onCheckedChange={() => setPerformanceModeEnabled(current => !current)}
        />
        <MenuSwitchItem label="Touch feedback" description="Subtle haptics on supported devices" checked={sensory.haptics} onCheckedChange={() => setSensoryPreference('haptics', !sensory.haptics)} />
        <MenuSwitchItem label="Interaction sounds" description="Quiet game and confirmation sounds" checked={sensory.sounds} onCheckedChange={() => setSensoryPreference('sounds', !sensory.sounds)} />
        <DropdownMenuSeparator className="my-2" />
        {enabled && (
          <DropdownMenuItem onSelect={() => { pendingDialogRef.current = () => start(); }} className={actionClassName}>
            <PlayCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            Tutorial
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => openExternalUrl("https://doc.pixotchi.tech")} className={actionClassName}>
          <BookOpen className="h-4 w-4 shrink-0" aria-hidden="true" />
          Documentation
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => { pendingDialogRef.current = () => { setFeedbackOpened(true); setFeedbackOpen(true); }; }} className={actionClassName}>
          <MessageCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          Feedback
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => openExternalUrl("https://status.pixotchi.tech")} className={actionClassName}>
          <Radio className="h-4 w-4 shrink-0" aria-hidden="true" />
          Service status
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onAbout} className={actionClassName}>
          <Info className="h-4 w-4 shrink-0" aria-hidden="true" />
          About
        </DropdownMenuItem>
        <DropdownMenuSeparator className="my-2" />
        <div role="group" aria-label="Community" className="grid grid-cols-3 gap-1">
          <DropdownMenuItem onSelect={() => openExternalUrl("https://x.com/pixotchi")} aria-label="Open Pixotchi on X" title="X" className="justify-center px-1">
            <XBrandIcon className="h-5 w-5 shrink-0" />
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openExternalUrl("https://t.me/pixotchi")} aria-label="Open Pixotchi on Telegram" title="Telegram" className="justify-center px-1">
            <TelegramBrandIcon className="h-5 w-5 shrink-0" />
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openExternalUrl("https://farcaster.xyz/pixotchi.eth")} aria-label="Open Pixotchi on Farcaster" title="Farcaster" className="justify-center px-1">
            <FarcasterBrandIcon className="h-5 w-5 shrink-0" />
          </DropdownMenuItem>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 pb-1 pt-2 text-xs text-muted-foreground">
          <span>Built on Base</span>
          <span>v{packageJson.version}</span>
        </div>
      </ThemeSelector>
      {/* Load on first use; keep mounted afterward so closing preserves a draft. */}
      {feedbackOpened && <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />}
    </>
  );
}
