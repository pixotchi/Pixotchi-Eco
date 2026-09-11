"use client";

import { useId, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { Loader2, MessageCircle } from "lucide-react";
import { toast } from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useFrameContext } from "@/lib/frame-context";
import { useSmartWallet } from "@/lib/smart-wallet-context";
import { readMiniAppPresentation } from "@/lib/auth-presentation-data";

export default function FeedbackDialog({ open, onOpenChange }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const feedbackTextId = useId();
  const feedbackHelpId = useId();
  const { address } = useAccount();
  const { walletType, isSmartWallet } = useSmartWallet();
  const frameData = useFrameContext();
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const feedbackDraftRef = useRef(feedbackText);
  feedbackDraftRef.current = feedbackText;
  const feedbackDialogRevisionRef = useRef(0);

  const submitFeedback = async () => {
    if (!address) {
      toast.error('Please connect your wallet first');
      return;
    }

    if (!feedbackText.trim()) {
      toast.error('Please enter your feedback');
      return;
    }

    if (feedbackText.trim().length < 10 || feedbackText.trim().length > 1000) {
      setFeedbackError('Feedback must contain 10–1000 characters.');
      return;
    }

    const submittedDraft = feedbackText;
    const dialogRevision = feedbackDialogRevisionRef.current;
    const isCurrentDraft = () => feedbackDraftRef.current === submittedDraft && feedbackDialogRevisionRef.current === dialogRevision;
    setFeedbackError(null);
    setFeedbackLoading(true);
    try {
      // Collect wallet profile data
      const isMiniApp = Boolean(frameData?.isInMiniApp);
      const fcContext = readMiniAppPresentation(frameData?.context);

      // Extract farcaster details
      const farcasterDetails = isMiniApp && fcContext ? {
          fid: fcContext.user?.fid,
          username: fcContext.user?.username,
          displayName: fcContext.user?.displayName,
          clientType: fcContext.client?.platformType,
          referrerDomain: fcContext.location.referrer,
        } : null;

      const response = await fetch('/api/feedback/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address,
          message: feedbackText.trim(),
          walletType,
          isSmartWallet,
          isMiniApp,
          farcasterDetails,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        toast.success('Thank you for your feedback!');
        if (isCurrentDraft()) {
          setFeedbackText('');
          onOpenChange(false);
        }
      } else {
        if (isCurrentDraft()) setFeedbackError(data.error || 'Failed to submit feedback. Your draft is saved; try again.');
      }
    } catch (error) {
      console.error('Feedback submission error:', error);
      if (isCurrentDraft()) setFeedbackError('Failed to submit feedback. Your draft is saved; try again.');
    } finally {
      setFeedbackLoading(false);
    }
  };

  return (
      <Dialog open={open} onOpenChange={open => { feedbackDialogRevisionRef.current += 1; onOpenChange(open); }}>
          <DialogContent mobileMode="center" surface="soft" className="w-[min(94vw,28rem)] max-w-md">
            <DialogHeader className="mb-6">
            <DialogTitle>Share Your Feedback</DialogTitle>
            <DialogDescription>
              We&apos;d love to hear your thoughts on Pixotchi!
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <label htmlFor={feedbackTextId} className="text-sm font-medium">
                Feedback
              </label>
              <p id={feedbackHelpId} className="text-xs text-muted-foreground">
                Share bugs, feature requests, or suggestions. 10–1000 characters.
              </p>
            </div>
            <Textarea
              id={feedbackTextId}
              name="feedback"
              placeholder="What's on your mind? (e.g., bugs, feature requests, suggestions)"
              value={feedbackText}
              onChange={(e) => { setFeedbackText(e.target.value); setFeedbackError(null); }}
              rows={5}
              maxLength={1000}
              className="min-h-32 w-full"
              spellCheck={true}
              autoComplete="off"
              aria-describedby={feedbackHelpId}
            />
            <p className="text-xs text-muted-foreground" aria-live="polite">{feedbackText.length}/1000 characters</p>
            {!address && <p role="note" className="text-sm text-muted-foreground">Connect your wallet to send feedback. Your draft will stay here.</p>}
            {feedbackError && <p role="alert" className="text-sm text-destructive">{feedbackError}</p>}
            <Button
              type="button"
              onClick={submitFeedback}
              disabled={feedbackLoading || !address || feedbackText.trim().length < 10 || feedbackText.trim().length > 1000}
              aria-busy={feedbackLoading}
              className="w-full"
            >
              {feedbackLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  Sending...
                </>
              ) : (
                <>
                  <MessageCircle className="w-4 h-4 mr-2" />
                  Send Feedback
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
  );
}
