'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Hex } from 'viem';
import { base } from 'viem/chains';
import { useAccount } from 'wagmi';
import { useShowCallsStatus } from 'wagmi/experimental';
import { Button } from '@/components/ui/button';
import { handleExternalAnchorClick, openExternalUrl } from '@/lib/open-external';
import { getPendingActionLabel, getTransactionFeedback } from '@/lib/transaction-feedback';
import { cn } from '@/lib/utils';
import { TransactionFeedbackCard, TransactionFeedbackIcon, type TransactionFeedbackPosition } from './transaction-feedback-card';
import { TransactionRecoveryOptions } from './transaction-recovery-options';
import { TransactionContext, useTransactionContext, type TransactionContextValue, type LifecycleStatus } from './transaction-context';
import { getExplorerHref } from './transaction-links';

type TransactionButtonRenderProps = {
  status: "default" | "error" | "pending" | "success";
  context: TransactionContextValue;
  onSubmit: () => void;
  onSuccess: () => void;
  isDisabled: boolean;
};

type TransactionButtonProps = {
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
  text?: string;
  pendingText?: string;
  render?: (props: TransactionButtonRenderProps) => React.ReactNode;
};

type TransactionStatusProps = {
  suppressSuccess?: boolean;
  children?: React.ReactNode;
  className?: string;
};

type TransactionStatusActionProps = {
  className?: string;
};

type TransactionStatusLabelProps = {
  className?: string;
};

type TransactionToastProps = {
  suppressSuccess?: boolean;
  successMessage?: string;
  children?: React.ReactNode;
  className?: string;
  duration?: number;
  position?: TransactionFeedbackPosition;
};

export type TransactionFeedbackMode = "inline" | "toast" | "none";

type TransactionToastActionProps = {
  className?: string;
};

type TransactionToastIconProps = {
  className?: string;
};

type TransactionToastLabelProps = {
  className?: string;
};

const PRESSABLE_PRIMARY =
  "cursor-pointer bg-primary bg-[image:var(--gradient-control-active)] hover:brightness-[1.03] active:brightness-[0.98] focus:brightness-[0.98]";
const PRESSABLE_DISABLED = "opacity-[0.38] pointer-events-none";
const TEXT_HEADLINE = "ock-compat-font font-semibold";
const TEXT_LABEL1 = "ock-compat-font text-sm font-semibold";
const TEXT_LABEL2 = "ock-compat-font text-sm";
const TEXT_DEFAULT = "text-[var(--ock-compat-foreground)]";
const TEXT_INVERSE = "text-primary-foreground";
const TEXT_PRIMARY = "text-[var(--ock-compat-primary)]";
const TEXT_ERROR = "text-[var(--ock-compat-error)]";
const TOAST_ACTION_LAYOUT =
  "min-h-11 rounded-lg px-2.5 text-xs font-semibold shadow-none";

function Spinner({ className }: { className?: string }) {
  return (
    <div
      className="flex shrink-0 items-center justify-center"
      data-testid="ockSpinner"
      aria-hidden="true"
    >
      <div
        className={cn(
          "h-4 w-4 animate-spin rounded-full border-2 border-current/25 border-t-current",
          className,
        )}
      />
    </div>
  );
}

type FeedbackInput = {
  errorMessage: string | null;
  isExecuting: boolean;
  status: LifecycleStatus;
  transactionHash?: Hex;
  transactionId: string | null;
};

function getToastLabelData(input: FeedbackInput) {
  const feedback = getTransactionFeedback({
    statusName: input.status.statusName,
    hasProof: Boolean(input.transactionHash || input.transactionId),
    errorMessage: input.errorMessage,
    syncDelayed: Boolean(input.status.statusData.error),
  });
  return {
    ...feedback,
    feedback,
    label: feedback?.title ?? "",
    labelClassName: feedback?.tone === "error" ? TEXT_ERROR : TEXT_DEFAULT,
  };
}

function getStatusLabelData(input: FeedbackInput) {
  const feedback = getToastLabelData(input);
  return {
    label: [feedback.label, feedback.description].filter(Boolean).join('. '),
    labelClassName: feedback.labelClassName,
  };
}

export function TransactionButton({
  ariaLabel,
  className,
  disabled = false,
  text: idleText = "Transact",
  pendingText,
  render,
}: TransactionButtonProps) {
  const context = useTransactionContext();
  const { address } = useAccount();
  const { showCallsStatus } = useShowCallsStatus();
  const {
    canSubmit,
    chainId,
    errorMessage,
    explorerHref,
    isExecuting,
    isSubmissionLocked,
    submissionLockMessage,
    receipt,
    retrySync,
    retryWalletRouting,
    status: lifecycleStatus,
    submit,
    transactionHash,
    transactionId,
  } = context;

  const isSuccessful = lifecycleStatus.statusName === "success";
  const isSubmissionAmbiguous = lifecycleStatus.statusName === "submissionAmbiguous";
  const isUnresolved = lifecycleStatus.statusName === "transactionUnresolved";
  const isStale = lifecycleStatus.statusName === "transactionStale";
  const isConfirmedSyncing = lifecycleStatus.statusName === "confirmedSyncing";
  const isCheckOnly = isUnresolved || isStale;
  const isWalletRoutingRetry = submissionLockMessage === "Retry wallet check";
  const isDisabled = isConfirmedSyncing
    ? isExecuting
    : !isSuccessful
      && !isCheckOnly
      && (isExecuting || (isSubmissionLocked && !isWalletRoutingRetry) || disabled || !canSubmit);

  const handleSuccess = useCallback(() => {
    if (receipt && transactionId && transactionHash && chainId && address) {
      const url = new URL("https://wallet.coinbase.com/assets/transactions");
      url.searchParams.set("contentParams[txHash]", transactionHash);
      url.searchParams.set("contentParams[chainId]", JSON.stringify(chainId));
      url.searchParams.set("contentParams[fromAddress]", address);
      // `url` is a URL object here — openExternalUrl takes a string.
      void openExternalUrl(url.toString());
      return;
    }

    if (transactionId) {
      showCallsStatus({ id: transactionId });
      return;
    }

    const transactionHref = explorerHref || getExplorerHref(transactionHash, base.blockExplorers?.default.url);
    if (!transactionHref) {
      return;
    }

    // window.open is inert inside the Farcaster / Base Mini App webview, which is
    // this app's primary surface — the "view your transaction" link silently did
    // nothing there. openExternalUrl routes through sdk.actions.openUrl in the
    // webview and falls back to window.open on plain web.
    void openExternalUrl(transactionHref);
  }, [
    address,
    chainId,
    explorerHref,
    receipt,
    showCallsStatus,
    transactionHash,
    transactionId,
  ]);

  const buttonContent = useMemo(() => {
    if (isSuccessful) {
      return "View transaction";
    }
    if (isConfirmedSyncing) {
      return "Refresh game";
    }
    if (isCheckOnly) {
      return "View transaction";
    }
    if (isSubmissionAmbiguous) {
      return "Confirmation delayed";
    }
    if (submissionLockMessage) {
      return submissionLockMessage;
    }
    if (errorMessage) {
      return "Try again";
    }
    if (isExecuting) {
      return (
        <>
          <Spinner />
          <span className="min-w-0 [overflow-wrap:anywhere]">{pendingText ?? getPendingActionLabel(idleText)}</span>
        </>
      );
    }
    return idleText;
  }, [
    errorMessage,
    idleText,
    pendingText,
    isCheckOnly,
    isConfirmedSyncing,
    isExecuting,
    isSubmissionAmbiguous,
    isSuccessful,
    submissionLockMessage,
  ]);

  const handleSubmit = useCallback(() => {
    if (isConfirmedSyncing) {
      retrySync();
      return;
    }
    if (isSuccessful || isCheckOnly) {
      handleSuccess();
      return;
    }
    if (isWalletRoutingRetry) {
      retryWalletRouting();
      return;
    }

    if (isDisabled) return;
    submit();
  }, [handleSuccess, isCheckOnly, isConfirmedSyncing, isDisabled, isSuccessful, isWalletRoutingRetry, retrySync, retryWalletRouting, submit]);

  const status = useMemo<"default" | "error" | "pending" | "success">(() => {
    if (isSuccessful) {
      return "success";
    }
    if (errorMessage) {
      return "error";
    }
    if (isWalletRoutingRetry) {
      return "error";
    }
    if (isExecuting || isCheckOnly || isConfirmedSyncing || submissionLockMessage !== null) {
      return "pending";
    }
    return "default";
  }, [errorMessage, isCheckOnly, isConfirmedSyncing, isExecuting, isSuccessful, isWalletRoutingRetry, submissionLockMessage]);

  const resolvedAriaLabel = ariaLabel
    ?? (isSuccessful
      ? "View transaction"
      : isConfirmedSyncing
        ? "Refresh game"
      : isCheckOnly
        ? "View transaction"
        : submissionLockMessage
          ? submissionLockMessage
          : errorMessage
          ? "Try again"
          : isExecuting
            ? pendingText ?? getPendingActionLabel(idleText)
            : idleText);

  if (render) {
    return render({
      context,
      isDisabled,
      onSubmit: handleSubmit,
      onSuccess: handleSuccess,
      status,
    });
  }

  return (
    <button
      className={cn(
        PRESSABLE_PRIMARY,
        "flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--radius-control)] px-4 py-3 text-sm font-semibold leading-none shadow-[var(--shadow-control)] transition-[background-color,color,box-shadow,opacity,transform] duration-[var(--motion-quick)]",
        isDisabled && PRESSABLE_DISABLED,
        TEXT_HEADLINE,
        TEXT_INVERSE,
        className,
        // Status labels can be longer than the idle action. Let the control
        // grow instead of clipping text inside a caller's fixed height.
        "h-auto min-w-0 max-w-full whitespace-normal leading-snug [overflow-wrap:anywhere]",
      )}
      onClick={handleSubmit}
      type="button"
      disabled={isDisabled}
      aria-label={resolvedAriaLabel}
      aria-live="polite"
      data-testid="ockTransactionButton_Button"
    >
      {typeof buttonContent === "string"
        ? <span className="min-w-0 [overflow-wrap:anywhere]">{buttonContent}</span>
        : buttonContent}
    </button>
  );
}

/** Keep recovery reachable after dismissing a delayed transaction's popup. */
export function TransactionRecoveryFallback() {
  const { status, isToastVisible, acknowledgeStale, isExecuting } = useTransactionContext();
  if (isToastVisible || status.statusName !== 'transactionStale') return null;
  return <TransactionRecoveryOptions onContinue={() => { void acknowledgeStale(); }} disabled={isExecuting} />;
}

export function TransactionStatus({
  suppressSuccess = false,
  children,
  className,
}: TransactionStatusProps) {
  const { errorMessage, isExecuting, status, transactionHash, transactionId } =
    useTransactionContext();
  const { label } = getStatusLabelData({
    errorMessage,
    isExecuting,
    status,
    transactionHash,
    transactionId,
  });

  if (!label || (suppressSuccess && status.statusName === 'success')) {
    return null;
  }

  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-2", className)}>
      {children ?? (
        <>
          <TransactionStatusLabel />
          <TransactionStatusAction />
        </>
      )}
    </div>
  );
}

function TransactionStatusAction({
  className,
}: TransactionStatusActionProps) {
  const {
    acknowledgeStale,
    isExecuting,
    explorerHref,
    receipt,
    status,
    transactionHash,
    transactionId,
  } = useTransactionContext();
  const { showCallsStatus } = useShowCallsStatus();
  const isStale = status.statusName === "transactionStale";

  const actionElement = useMemo(() => {
    if (receipt) {
      return null;
    }

    const transactionHref =
      explorerHref || getExplorerHref(transactionHash, base.blockExplorers?.default.url);

    if (transactionHash && transactionHref) {
      return (
        <Button asChild size="touchCompact" variant="ghost" className={cn(TEXT_LABEL1, TEXT_PRIMARY)}>
          <a
            href={transactionHref}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => handleExternalAnchorClick(event, transactionHref)}
          >
            View transaction
          </a>
        </Button>
      );
    }

    if (transactionId) {
      return (
        <Button
          onClick={() => showCallsStatus({ id: transactionId })}
          size="touchCompact"
          type="button"
          variant="ghost"
          className={cn(TEXT_LABEL1, TEXT_PRIMARY)}
        >
          View transaction
        </Button>
      );
    }

    return null;
  }, [explorerHref, receipt, showCallsStatus, transactionHash, transactionId]);

  if (!actionElement && !isStale) {
    return null;
  }

  return (
    <div className={cn(TEXT_LABEL2, "flex min-w-[70px] max-w-full flex-wrap justify-end gap-2", className)}>
      {actionElement}
      {isStale && <TransactionRecoveryOptions onContinue={() => { void acknowledgeStale(); }} disabled={isExecuting} />}
    </div>
  );
}

function TransactionStatusLabel({
  className,
}: TransactionStatusLabelProps) {
  const { errorMessage, isExecuting, status, transactionHash, transactionId } =
    useTransactionContext();
  const { label, labelClassName } = getStatusLabelData({
    errorMessage,
    isExecuting,
    status,
    transactionHash,
    transactionId,
  });

  if (!label) {
    return null;
  }

  return (
    <div className={cn(TEXT_LABEL2, className)}>
      <p className={labelClassName}>{label}</p>
    </div>
  );
}

export function TransactionToast({
  suppressSuccess = false,
  successMessage,
  children,
  className,
  position = "auto",
}: TransactionToastProps) {
  const context = useTransactionContext();
  const { dismissToast, isToastVisible, pauseToastTimer, resumeToastTimer } = context;
  const { feedback } = getToastLabelData(context);
  const shouldShow = Boolean(isToastVisible && feedback && !(suppressSuccess && feedback.tone === 'success'));
  const lastVisibleContext = useRef(context);
  if (shouldShow) lastVisibleContext.current = context;
  const [renderState, setRenderState] = useState<"hidden" | "visible" | "exiting">(
    shouldShow ? "visible" : "hidden",
  );
  const paused = useRef({ pointer: false, focus: false });
  const setPaused = (source: 'pointer' | 'focus', value: boolean) => {
    if (paused.current[source] === value) return;
    paused.current[source] = value;
    if (value) pauseToastTimer();
    else resumeToastTimer();
  };
  useEffect(() => () => {
    if (paused.current.pointer) resumeToastTimer();
    if (paused.current.focus) resumeToastTimer();
    paused.current = { pointer: false, focus: false };
  }, [resumeToastTimer]);
  useEffect(() => {
    if (shouldShow) {
      setRenderState("visible");
      return;
    }
    if (paused.current.pointer) resumeToastTimer();
    if (paused.current.focus) resumeToastTimer();
    paused.current = { pointer: false, focus: false };
    setRenderState((previous) => previous === "visible" ? "exiting" : previous);
    const timer = window.setTimeout(() => setRenderState("hidden"), 180);
    return () => window.clearTimeout(timer);
  }, [shouldShow, resumeToastTimer]);

  const displayContext = shouldShow ? context : lastVisibleContext.current;
  const displayed = getToastLabelData(displayContext).feedback;
  if (renderState === "hidden" || !displayed || (suppressSuccess && displayed.tone === 'success')) return null;

  return (
    <TransactionContext.Provider value={displayContext}>
      <TransactionFeedbackCard
        feedback={displayed.tone === "success" && successMessage ? { ...displayed, description: successMessage } : displayed}
        actions={<TransactionToastAction />}
        className={className}
        position={position}
        exiting={!shouldShow || renderState === "exiting"}
        onDismiss={dismissToast}
        onPointerEnter={(event) => { if (event.pointerType === 'mouse') setPaused('pointer', true); }}
        onPointerLeave={() => setPaused('pointer', false)}
        onFocusCapture={() => setPaused('focus', true)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused('focus', false);
        }}
      >
        {children}
      </TransactionFeedbackCard>
    </TransactionContext.Provider>
  );
}

export function TransactionToastIcon({ className }: TransactionToastIconProps) {
  const context = useTransactionContext();
  const { feedback } = getToastLabelData(context);
  return feedback ? <TransactionFeedbackIcon feedback={feedback} className={className} /> : null;
}

export function TransactionToastLabel({ className }: TransactionToastLabelProps) {
  const context = useTransactionContext();
  const { feedback } = getToastLabelData(context);
  if (!feedback) return null;
  return (
    <div className={cn("min-w-0", className)}>
      <p className="text-sm font-semibold leading-5 text-foreground">{feedback.title}</p>
      {feedback.description && <p className="mt-1 text-[13px] leading-[1.45] text-muted-foreground">{feedback.description}</p>}
    </div>
  );
}

export function TransactionToastAction({
  className,
}: TransactionToastActionProps) {
  const {
    canSubmit,
    acknowledgeStale,
    errorMessage,
    submit,
    explorerHref,
    status,
    transactionHash,
    transactionId,
    retrySync,
    isExecuting,
    isSubmissionLocked,
  } =
    useTransactionContext();
  const { showCallsStatus } = useShowCallsStatus();
  const isStale = status.statusName === "transactionStale";
  const isSyncDelayed = status.statusName === "confirmedSyncing" && Boolean(status.statusData.error);

  const actionElement = useMemo(() => {
    if (isSyncDelayed) {
      return (
        <Button size="touchCompact" variant="ghost" className={TOAST_ACTION_LAYOUT} onClick={retrySync} disabled={isExecuting}>
          Refresh game
        </Button>
      );
    }
    if (transactionHash) {
      const viewHref =
        explorerHref || getExplorerHref(transactionHash, base.blockExplorers?.default.url) || undefined;
      return (
        <Button
          asChild
          size="compact"
          variant="ghost"
          className={cn(TEXT_LABEL1, TEXT_PRIMARY, TOAST_ACTION_LAYOUT)}
        >
          <a
            href={viewHref}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => {
              if (viewHref) handleExternalAnchorClick(event, viewHref);
            }}
          >
            View transaction
          </a>
        </Button>
      );
    }

    if (transactionId) {
      return (
        <Button
          onClick={() => showCallsStatus({ id: transactionId })}
          size="compact"
          type="button"
          variant="ghost"
          className={cn(TEXT_LABEL1, TEXT_PRIMARY, TOAST_ACTION_LAYOUT)}
        >
          View transaction
        </Button>
      );
    }

    if (errorMessage && !isSubmissionLocked) {
      return (
        <Button
          className={cn(TEXT_LABEL1, TEXT_PRIMARY, TOAST_ACTION_LAYOUT)}
          size="compact"
          type="button"
          variant="ghost"
          onClick={() => submit("retry")}
          disabled={!canSubmit || isExecuting}
        >
          Try again
        </Button>
      );
    }

    return null;
  }, [canSubmit, errorMessage, explorerHref, isExecuting, isSubmissionLocked, isSyncDelayed, retrySync, showCallsStatus, submit, transactionHash, transactionId]);

  if (!actionElement && !isStale) {
    return null;
  }

  return (
    <div className={cn("-ml-2.5 mt-2 flex min-w-0 flex-wrap items-center justify-start gap-x-1 gap-y-0.5", className)}>
      {actionElement}
      {isStale && <TransactionRecoveryOptions onContinue={() => { void acknowledgeStale(); }} disabled={isExecuting} />}
    </div>
  );
}
