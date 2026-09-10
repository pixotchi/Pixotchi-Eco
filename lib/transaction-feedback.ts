export type TransactionFeedback = {
  title: string;
  description?: string;
  tone: 'neutral' | 'progress' | 'success' | 'warning' | 'error';
  icon: 'loading' | 'wallet' | 'check' | 'info' | 'error';
};

/** Fallback only: feature actions can supply an explicit pending label. */
export function getPendingActionLabel(idleText: string): string {
  const text = idleText.trim().toLowerCase();
  if (/^approve\b/.test(text)) return text.includes('+') ? 'Processing approval and action…' : 'Approving…';
  if (/^unstake\b/.test(text)) return 'Unstaking…';
  if (/^stake\b/.test(text)) return 'Staking…';
  if (/\bmint\b/.test(text)) return 'Minting…';
  if (/\bclaim\b/.test(text)) return 'Claiming…';
  if (/\b(buy|purchase)\b/.test(text)) return 'Purchasing…';
  if (/\btransfer\b/.test(text)) return 'Transferring…';
  if (/\bspin\b/.test(text)) return 'Spinning…';
  if (/\bdeal\b/.test(text)) return 'Dealing…';
  return 'Processing…';
}

export function friendlyTransactionError(message: string): string {
  const text = message.toLowerCase();
  if (/user rejected|rejected the request|user denied/.test(text)) {
    return 'Nothing was sent. Try again whenever you’re ready.';
  }
  if (/wallet client unavailable|wallet not connected|connect.*wallet/.test(text)) {
    return 'Connect your wallet, then try again.';
  }
  if (/quote changed|eth price changed|purchase changed/.test(text)) {
    return 'Review the updated quote and purchase details, then confirm again.';
  }
  if (/quote could not be verified|wait for.*quote/.test(text)) {
    return 'Retry the quote before confirming this purchase.';
  }
  if (/atomic execution|atomic bundled/.test(text)) {
    return 'This action needs a wallet that can approve all its steps together. Try a supported smart wallet.';
  }
  if (/insufficient funds|gas required|gas fee/.test(text)) {
    return 'You need a little more ETH to cover the network fee.';
  }
  if (/insufficient|not enough/.test(text)) {
    return 'You don’t have enough tokens for this action.';
  }
  if (/chain mismatch|wrong chain|switch.*base/.test(text)) {
    return 'Switch your wallet to Base, then try again.';
  }
  if (/revert|requirements/.test(text)) {
    return 'Check that you still meet the requirements, then try again.';
  }
  if (/network|fetch|offline|connection/.test(text)) {
    return 'Check your connection, then try again.';
  }
  return 'Please try again. If it keeps happening, come back in a moment.';
}

/** Presentation only: an uncertain outcome must never be described as a failure. */
export function getTransactionFeedback({
  statusName,
  hasProof = false,
  errorMessage,
  syncDelayed = false,
}: {
  statusName: string;
  hasProof?: boolean;
  errorMessage?: string | null;
  syncDelayed?: boolean;
}): TransactionFeedback | null {
  switch (statusName) {
    case 'idle': return null;
    case 'buildingTransaction':
      return { title: 'Preparing transaction', tone: 'progress', icon: 'loading' };
    case 'transactionPending':
      return hasProof
        ? { title: 'Transaction submitted', description: 'Waiting for confirmation.', tone: 'progress', icon: 'loading' }
        : { title: 'Confirm in your wallet', tone: 'neutral', icon: 'wallet' };
    case 'transactionUnresolved':
      return { title: 'Processing', description: 'This is taking longer than usual.', tone: 'progress', icon: 'info' };
    case 'submissionAmbiguous':
      return { title: 'Confirmation delayed', description: 'Your transaction may still complete.', tone: 'warning', icon: 'info' };
    case 'transactionStale':
      return { title: 'Confirmation delayed', description: 'We haven’t received a final result yet.', tone: 'warning', icon: 'info' };
    case 'confirmedSyncing':
      return syncDelayed
        ? { title: 'Transaction confirmed', description: 'Refresh your game to see the result.', tone: 'warning', icon: 'check' }
        : { title: 'Transaction confirmed', description: 'Updating your game…', tone: 'progress', icon: 'loading' };
    case 'success':
      return { title: 'Action complete', description: 'You’re all set.', tone: 'success', icon: 'check' };
    case 'superseded':
      return { title: 'Action replaced in wallet', description: 'This action did not run. Review your wallet activity before trying again.', tone: 'neutral', icon: 'info' };
    case 'cancelled':
    case 'canceled':
    case 'rejected':
    case 'transactionRejected':
    case 'userRejected':
      return { title: 'Action canceled', description: 'You can try again whenever you’re ready.', tone: 'neutral', icon: 'info' };
    default:
      return { title: 'That didn’t go through', description: friendlyTransactionError(errorMessage ?? ''), tone: 'error', icon: 'error' };
  }
}
