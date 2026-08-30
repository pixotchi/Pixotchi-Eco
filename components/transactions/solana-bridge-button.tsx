"use client";

import { Button } from '@/components/ui/button';
import { useSolanaBridge } from '@/hooks/useSolanaBridge';
import { useSolanaWallet } from '@/hooks/useSolanaWallet';
import {
  acquirePendingBridgeReservation,
  clearPendingBridgeAction,
  confirmSolanaTransaction,
  finalizePendingBridgeReservation,
  loadPendingBridgeRecord,
  loadPendingBridgeAction,
  markPendingBridgeWalletRequest,
  PENDING_BRIDGE_ACTION_EVENT,
  PENDING_BRIDGE_PREPARATION_STALE_MS,
  PendingBridgeStorageUnavailableError,
  recoverPendingBridgeWalletRequest,
  releasePendingBridgeReservation,
  replacePendingBridgeAction,
  SolanaConfirmationTimeoutError,
  SolanaTransactionExecutionError,
  SolanaTransactionExpiredError,
  verifySolanaTwinSetup,
  waitForBaseBridgeExecution,
  type BaseBridgeExecutionResult,
  type PendingBridgeAction,
  type PendingBridgeActionChange,
  type PendingBridgeRecord,
  type PendingBridgeReservation,
  type SolanaBridgeLifecyclePhase,
} from '@/lib/solana-bridge-lifecycle';
import {
  getEffectiveSolanaAction,
  getSolanaActionButtonLabel,
  getSolanaActionKey,
  getSolanaQuoteKey,
  isCurrentSolanaQuoteGeneration,
  nextSolanaQuoteGeneration,
} from '@/lib/solana-bridge-flow';
import { BRIDGE_CONFIG } from '@/lib/solana-constants';
import { createSolanaBridgeTransaction } from '@/lib/solana-bridge-executor';
import { invalidateOwnerResources, type OwnerResourceDomain } from '@/lib/owner-resource-invalidation';
import { useSignAndSendTransaction, useWallets as useSolanaWallets } from '@privy-io/react-auth/solana';
import bs58 from 'bs58';
import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';

export type SolanaBridgeActionType =
  | 'setup'
  | 'mint'
  | 'shopItem'
  | 'gardenItem'
  | 'setName'
  | 'claimRewards'
  | 'attack';

export interface SolanaBridgeButtonProps {
  actionType: SolanaBridgeActionType;
  plantId?: number;
  itemId?: number | string;
  targetId?: number;
  strain?: number;
  name?: string;
  buttonText?: string;
  buttonClassName?: string;
  disabled?: boolean;
  /** Fires only after the requested action is confirmed on Base. */
  onSuccess?: (signature: string) => void;
  onError?: (error: UntypedValue) => void;
  onQuote?: (quote: { wsolAmount: bigint; error?: string } | null) => void;
  onPendingChange?: (pending: boolean) => void;
}

type LocalQuote = {
  key: string;
  wsolAmount: bigint;
  error?: string;
};

const DEFAULT_LABELS: Record<SolanaBridgeActionType, string> = {
  setup: 'Setup Bridge',
  mint: 'Mint Plant',
  shopItem: 'Buy Item',
  gardenItem: 'Buy Item',
  setName: 'Set Name',
  claimRewards: 'Claim Rewards',
  attack: 'Attack',
};

const PHASE_LABELS: Record<SolanaBridgeLifecyclePhase, string> = {
  submitted: 'Submitted to Solana...',
  'solana-confirming': 'Confirming on Solana...',
  'solana-confirmed': 'Solana confirmed...',
  'relay-pending': 'Waiting for Base execution...',
  'base-confirmed': 'Confirmed on Base',
};

function isExplicitWalletRejection(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 4001 || code === 'ACTION_REJECTED') return true;
  const message = error instanceof Error ? error.message : String(error);
  return /user (?:rejected|denied)|request (?:rejected|cancelled)|declined by user/i.test(message);
}

function loadMatchingPendingAction(action: PendingBridgeAction): PendingBridgeAction {
  const stored = loadPendingBridgeAction(action.actionKey);
  return stored?.attemptId === action.attemptId ? stored : action;
}

export default function SolanaBridgeButton({
  actionType,
  plantId,
  itemId,
  targetId,
  strain,
  name,
  buttonText,
  buttonClassName = '',
  disabled = false,
  onSuccess,
  onError,
  onQuote,
  onPendingChange,
}: SolanaBridgeButtonProps) {
  const bridge = useSolanaBridge();
  const { solanaAddress, isTwinSetup, isConnected, refresh } = useSolanaWallet();
  const { ready: solanaWalletsReady, wallets: solanaWallets } = useSolanaWallets();
  const { signAndSendTransaction } = useSignAndSendTransaction();

  const [isLoading, setIsLoading] = useState(false);
  const [phase, setPhase] = useState<SolanaBridgeLifecyclePhase | null>(null);
  const [isQuoteLoading, setIsQuoteLoading] = useState(false);
  const [localQuote, setLocalQuote] = useState<LocalQuote | null>(null);
  const [pendingRecord, setPendingRecord] = useState<PendingBridgeRecord | null>(null);
  const submitLockRef = useRef(false);
  const quoteGenerationRef = useRef(0);
  const getQuoteRef = useRef(bridge.getQuote);
  const onQuoteRef = useRef(onQuote);
  const onPendingChangeRef = useRef(onPendingChange);

  useEffect(() => {
    getQuoteRef.current = bridge.getQuote;
  }, [bridge.getQuote]);

  useEffect(() => {
    onQuoteRef.current = onQuote;
  }, [onQuote]);

  useEffect(() => {
    onPendingChangeRef.current = onPendingChange;
  }, [onPendingChange]);

  const solanaWallet = useMemo(
    () => (solanaWalletsReady ? solanaWallets?.[0] ?? null : null),
    [solanaWallets, solanaWalletsReady],
  );

  const needsSetup =
    !isTwinSetup && ['mint', 'shopItem', 'gardenItem', 'setName'].includes(actionType);

  const actionParams = useMemo(
    () => ({ plantId, itemId, targetId, strain, name }),
    [itemId, name, plantId, strain, targetId],
  );
  const quoteKey = useMemo(
    () => getSolanaQuoteKey(actionType, actionParams),
    [actionParams, actionType],
  );
  const requestKey = useMemo(
    () => getSolanaActionKey(actionType, actionParams),
    [actionParams, actionType],
  );
  const actionStorageKey = useMemo(
    () =>
      solanaAddress
        ? `${solanaAddress}:active`
        : null,
    [solanaAddress],
  );
  const requiresQuote = quoteKey !== null;
  const currentQuote = localQuote?.key === quoteKey ? localQuote : null;
  const quoteReady = !requiresQuote || Boolean(currentQuote && !currentQuote.error);

  useEffect(() => {
    if (!actionStorageKey) {
      setPendingRecord(null);
      return;
    }
    const syncPendingAction = (event?: Event) => {
      const change = (event as CustomEvent<PendingBridgeActionChange> | undefined)?.detail;
      if (change && change.actionKey !== actionStorageKey) return;
      setPendingRecord(loadPendingBridgeRecord(actionStorageKey));
    };
    syncPendingAction();
    window.addEventListener(PENDING_BRIDGE_ACTION_EVENT, syncPendingAction);
    // Custom events synchronize buttons in this tab; the native storage event
    // synchronizes another open tab using the same wallet.
    window.addEventListener('storage', syncPendingAction);
    return () => {
      window.removeEventListener(PENDING_BRIDGE_ACTION_EVENT, syncPendingAction);
      window.removeEventListener('storage', syncPendingAction);
    };
  }, [actionStorageKey]);

  useEffect(() => {
    onPendingChangeRef.current?.(pendingRecord !== null);
  }, [pendingRecord]);

  useEffect(() => {
    if (
      !actionStorageKey
      || pendingRecord?.kind !== 'reservation'
      || pendingRecord.phase !== 'preparing'
    ) {
      return;
    }
    const remainingMs = Math.max(
      0,
      pendingRecord.createdAt + PENDING_BRIDGE_PREPARATION_STALE_MS - Date.now(),
    );
    const timeout = window.setTimeout(() => {
      setPendingRecord(loadPendingBridgeRecord(actionStorageKey));
    }, remainingMs + 50);
    return () => window.clearTimeout(timeout);
  }, [actionStorageKey, pendingRecord]);

  useEffect(() => {
    const generation = nextSolanaQuoteGeneration(quoteGenerationRef.current);
    quoteGenerationRef.current = generation;
    setLocalQuote(null);
    onQuoteRef.current?.(null);

    if (!isConnected || !requiresQuote || !quoteKey) {
      setIsQuoteLoading(false);
      return;
    }
    if (
      (actionType === 'shopItem' || actionType === 'gardenItem') &&
      (itemId === undefined || itemId === null || itemId === '')
    ) {
      setIsQuoteLoading(false);
      return;
    }
    if (actionType === 'mint' && strain === undefined) {
      setIsQuoteLoading(false);
      return;
    }

    let disposed = false;
    const fetchQuote = async () => {
      const requestGeneration = nextSolanaQuoteGeneration(quoteGenerationRef.current);
      quoteGenerationRef.current = requestGeneration;
      setIsQuoteLoading(true);
      try {
        const params =
          actionType === 'mint'
            ? { strain }
            : actionType === 'shopItem' || actionType === 'gardenItem'
              ? { itemId: Number(itemId) }
              : {};
        const result = await getQuoteRef.current(actionType, params);
        if (disposed || !isCurrentSolanaQuoteGeneration(requestGeneration, quoteGenerationRef.current)) return;

        const nextQuote: LocalQuote = result
          ? {
              key: quoteKey,
              wsolAmount: result.wsolAmount ?? BigInt(0),
              error: result.error,
            }
          : { key: quoteKey, wsolAmount: BigInt(0), error: 'No quote available' };
        setLocalQuote(nextQuote);
        onQuoteRef.current?.({
          wsolAmount: nextQuote.wsolAmount,
          error: nextQuote.error,
        });
      } catch (error) {
        if (disposed || !isCurrentSolanaQuoteGeneration(requestGeneration, quoteGenerationRef.current)) return;
        const nextQuote = {
          key: quoteKey,
          wsolAmount: BigInt(0),
          error: error instanceof Error ? error.message : 'Failed to get quote',
        };
        setLocalQuote(nextQuote);
        onQuoteRef.current?.({ wsolAmount: nextQuote.wsolAmount, error: nextQuote.error });
      } finally {
        if (!disposed && isCurrentSolanaQuoteGeneration(requestGeneration, quoteGenerationRef.current)) {
          setIsQuoteLoading(false);
        }
      }
    };

    void fetchQuote();
    const interval = window.setInterval(fetchQuote, BRIDGE_CONFIG.quoteValidityMs);
    return () => {
      disposed = true;
      quoteGenerationRef.current = Math.max(
        nextSolanaQuoteGeneration(quoteGenerationRef.current),
        nextSolanaQuoteGeneration(generation),
      );
      window.clearInterval(interval);
    };
  }, [actionType, isConnected, itemId, quoteKey, requiresQuote, strain]);

  const finalizeBaseResult = useCallback(
    async (action: PendingBridgeAction, result: BaseBridgeExecutionResult) => {
      const updatedAction = { ...action, messageHash: result.messageHash };

      if (result.status === 'base-confirmed') {
        const isSetupResult = action.implicitSetup || action.requestedAction === 'setup';
        if (isSetupResult) {
          let setupVerified = false;
          try {
            setupVerified = await verifySolanaTwinSetup(action.twinAddress);
          } catch {
            setupVerified = false;
          }
          if (!setupVerified) {
            setPendingRecord(updatedAction);
            await replacePendingBridgeAction(action, updatedAction);
            toast('Base execution is confirmed; waiting for bridge setup state to refresh.', {
              icon: 'ℹ️',
            });
            return;
          }
        }

        const ownsTerminal = await clearPendingBridgeAction(
          loadMatchingPendingAction(updatedAction),
        );
        if (!ownsTerminal) {
          // Another tab/component already consumed the same terminal proof, or
          // storage could not complete the exact CAS. Only the successful CAS
          // owner may fire refreshes, toasts, or consumer callbacks.
          setPendingRecord(loadPendingBridgeRecord(action.actionKey));
          setPhase(null);
          return;
        }
        setPendingRecord(null);
        setPhase('base-confirmed');
        bridge.reset();
        if (isSetupResult) {
          // Refresh only after winning the terminal CAS. A second tab may have
          // observed the same Base result, but it must not duplicate app-state
          // refreshes or callbacks after the first owner consumes the proof.
          await refresh();
        }

        if (action.implicitSetup) {
          invalidateOwnerResources({
            address: action.twinAddress,
            domains: ['balances'],
            source: 'solana-bridge:setup',
            transactionHash: action.signature,
          });
          toast.success('Bridge setup confirmed on Base. Press the action button again to continue.');
          return;
        }

        const requestedAction = action.requestedAction as SolanaBridgeActionType;
        const domains: readonly OwnerResourceDomain[] = requestedAction === 'setup'
          ? ['balances']
          : requestedAction === 'claimRewards'
            ? ['balances']
            : ['plants', 'balances'];
        invalidateOwnerResources({
          address: action.twinAddress,
          domains,
          source: `solana-bridge:${requestedAction}`,
          transactionHash: action.signature,
        });
        toast.success(`${DEFAULT_LABELS[requestedAction] ?? 'Bridge action'} confirmed on Base.`);
        window.dispatchEvent(
          new CustomEvent('solana-bridge:confirmed', {
            detail: { requestKey: action.requestKey, signature: action.signature },
          }),
        );
        if (action.requestKey === requestKey) {
          onSuccess?.(action.signature);
        }
        return;
      }

      setPendingRecord(updatedAction);
      await replacePendingBridgeAction(action, updatedAction);
      setPhase('relay-pending');
      if (result.status === 'relay-failed') {
        toast.error('The Base relay attempt failed. Do not resubmit; check again for a relay retry.');
      } else {
        toast('Solana is confirmed. The Base action is still processing.', { icon: 'ℹ️' });
      }
    },
    [bridge, onSuccess, refresh, requestKey],
  );

  const confirmAndTrack = useCallback(
    async (action: PendingBridgeAction, resume = false) => {
      const connection = (await import('@/lib/solana-bridge-implementation'))
        .solanaBridgeImplementation.getConnection();
      let currentAction = action;

      if (!currentAction.solanaConfirmed) {
        try {
          await confirmSolanaTransaction(connection, currentAction.signature, {
            onPhase: setPhase,
            blockhash: currentAction.recentBlockhash,
            lastValidBlockHeight: currentAction.lastValidBlockHeight,
            outgoingMessageAddress: currentAction.outgoingMessageAddress,
          });
        } catch (error) {
          if (
            error instanceof SolanaTransactionExecutionError ||
            error instanceof SolanaTransactionExpiredError
          ) {
            const ownsTerminal = await clearPendingBridgeAction(
              loadMatchingPendingAction(currentAction),
            );
            if (!ownsTerminal) {
              setPendingRecord(loadPendingBridgeRecord(currentAction.actionKey));
              setPhase(null);
              return;
            }
            setPendingRecord(null);
            throw error;
          }
          if (error instanceof SolanaConfirmationTimeoutError) {
            setPendingRecord(currentAction);
            setPhase('solana-confirming');
            toast('Transaction submitted; Solana confirmation is still pending.', { icon: 'ℹ️' });
            return;
          }
          setPendingRecord(currentAction);
          setPhase('solana-confirming');
          toast('Unable to verify Solana yet. Your submitted transaction is saved for recheck.', {
            icon: 'ℹ️',
          });
          return;
        }

        currentAction = { ...currentAction, solanaConfirmed: true };
        setPendingRecord(currentAction);
        await replacePendingBridgeAction(action, currentAction);
      }

      const result = await waitForBaseBridgeExecution(
        connection,
        { outgoingMessageAddress: currentAction.outgoingMessageAddress },
        {
          timeoutMs: resume
            ? BRIDGE_CONFIG.relayResumeWaitMs
            : BRIDGE_CONFIG.relayInitialWaitMs,
          knownMessageHash: currentAction.messageHash,
          onPhase: setPhase,
        },
      );
      await finalizeBaseResult(currentAction, result);
    },
    [finalizeBaseResult],
  );

  const prepareAction = useCallback(async () => {
    const { effectiveAction } = getEffectiveSolanaAction(actionType, needsSetup);
    switch (effectiveAction) {
      case 'setup':
        return bridge.prepareSetup();
      case 'mint':
        if (strain === undefined) throw new Error('Strain is required');
        return bridge.prepareMint(strain);
      case 'shopItem':
        if (plantId === undefined || itemId === undefined || itemId === '') {
          throw new Error('Plant ID and Item ID are required');
        }
        return bridge.prepareShopItem(plantId, Number(itemId));
      case 'gardenItem':
        if (plantId === undefined || itemId === undefined || itemId === '') {
          throw new Error('Plant ID and Item ID are required');
        }
        return bridge.prepareGardenItem(plantId, Number(itemId));
      case 'setName':
        if (plantId === undefined || !name) throw new Error('Plant ID and Name are required');
        return bridge.prepareSetName(plantId, name);
      case 'claimRewards':
        if (plantId === undefined) throw new Error('Plant ID is required');
        return bridge.prepareClaimRewards(plantId);
      case 'attack':
        if (plantId === undefined || targetId === undefined) {
          throw new Error('Plant ID and Target ID are required');
        }
        return bridge.prepareAttack(plantId, targetId);
      default:
        throw new Error('Unknown bridge action');
    }
  }, [actionType, bridge, itemId, name, needsSetup, plantId, strain, targetId]);

  const handleClick = useCallback(async () => {
    if (submitLockRef.current) return;
    if (!actionStorageKey || !solanaWallet || !solanaAddress || !signAndSendTransaction) {
      const error = new Error('Solana wallet is not ready');
      toast.error(error.message);
      onError?.(error);
      return;
    }

    submitLockRef.current = true;
    setIsLoading(true);
    let reservation: PendingBridgeReservation | null = null;
    let walletRequestStarted = false;
    try {
      // React state is advisory. Admission always re-reads a stable storage
      // snapshot so two components or tabs cannot both reach the wallet.
      const activeRecord = loadPendingBridgeRecord(actionStorageKey);
      if (activeRecord?.kind === 'submitted') {
        setPendingRecord(activeRecord);
        await confirmAndTrack(activeRecord, true);
        return;
      }
      if (activeRecord?.kind === 'reservation') {
        setPendingRecord(activeRecord);
        if (activeRecord.phase === 'preparing') {
          toast('This Solana action is already being prepared in another window.', {
            icon: 'ℹ️',
          });
          return;
        }

        setPhase('solana-confirming');
        const connection = (await import('@/lib/solana-bridge-implementation'))
          .solanaBridgeImplementation.getConnection();
        const recovery = await recoverPendingBridgeWalletRequest(activeRecord, connection);
        if (recovery.status === 'submitted') {
          setPendingRecord(recovery.action);
          toast('Recovered the submitted Solana transaction. Checking bridge execution...', {
            icon: 'ℹ️',
          });
          await confirmAndTrack(recovery.action, true);
          return;
        }
        if (recovery.status === 'cleared') {
          setPendingRecord(loadPendingBridgeRecord(actionStorageKey));
          setPhase(null);
          toast(
            'The previous wallet request expired without reaching Solana. It is now safe to try again.',
            { icon: 'ℹ️' },
          );
          return;
        }
        setPhase(null);
        toast(
          recovery.reason === 'landed-without-signature'
            ? 'Solana transaction evidence was found. Waiting for its signature index before continuing.'
            : recovery.reason === 'unexpired'
              ? 'The previous wallet request is still within its Solana validity window.'
              : 'The previous wallet request cannot be resolved safely yet. No new transaction was opened.',
          { icon: 'ℹ️' },
        );
        return;
      }

      setPhase(null);
      const admission = await acquirePendingBridgeReservation({
        actionKey: actionStorageKey,
        requestKey,
        requestedAction: actionType,
      });
      if (!admission.acquired) {
        if (admission.blocker?.kind === 'submitted') {
          setPendingRecord(admission.blocker);
          await confirmAndTrack(admission.blocker, true);
        } else {
          setPendingRecord(admission.blocker);
          toast('Another window is starting this Solana action. No second wallet request was opened.', {
            icon: 'ℹ️',
          });
        }
        return;
      }
      reservation = admission.reservation;
      setPendingRecord(reservation);

      const tx = await prepareAction();
      if (!tx) throw new Error(bridge.state.error || 'Failed to prepare transaction');

      const { transaction, metadata } = await createSolanaBridgeTransaction(
        solanaAddress,
        tx.params,
      );
      const serialized = transaction.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      });
      const { implicitSetup } = getEffectiveSolanaAction(actionType, needsSetup);
      const walletPendingReservation = await markPendingBridgeWalletRequest(
        reservation,
        {
          outgoingMessageAddress: metadata.outgoingMessageAddress,
          implicitSetup,
          twinAddress: tx.params.twinAddress,
          recentBlockhash: metadata.recentBlockhash,
          lastValidBlockHeight: metadata.lastValidBlockHeight,
        },
      );
      if (!walletPendingReservation) {
        throw new PendingBridgeStorageUnavailableError();
      }
      reservation = walletPendingReservation;
      setPendingRecord(reservation);
      walletRequestStarted = true;
      const { signature } = await signAndSendTransaction({
        transaction: serialized,
        wallet: solanaWallet,
        options: { skipPreflight: false },
      });
      const signatureString =
        typeof signature === 'string' ? signature : bs58.encode(signature);
      const submittedAction: PendingBridgeAction = {
        version: 2,
        kind: 'submitted',
        actionKey: actionStorageKey,
        attemptId: walletPendingReservation.attemptId,
        requestKey,
        requestedAction: actionType,
        createdAt: Date.now(),
        signature: signatureString,
        outgoingMessageAddress: metadata.outgoingMessageAddress,
        implicitSetup,
        solanaConfirmed: false,
        twinAddress: tx.params.twinAddress,
        recentBlockhash: metadata.recentBlockhash,
        lastValidBlockHeight: metadata.lastValidBlockHeight,
      };

      let submittedRecordPersisted = await finalizePendingBridgeReservation(
        walletPendingReservation,
        submittedAction,
      );
      if (!submittedRecordPersisted) {
        await new Promise((resolve) => window.setTimeout(resolve, 100));
        submittedRecordPersisted = await finalizePendingBridgeReservation(
          walletPendingReservation,
          submittedAction,
        );
      }
      if (!submittedRecordPersisted) {
        setPendingRecord(reservation);
        throw new Error(
          `Solana accepted ${signatureString}, but its recovery proof could not be saved. Do not resubmit.`,
        );
      }

      setPhase('submitted');
      setPendingRecord(submittedAction);
      toast('Transaction submitted to Solana. Confirming before Base execution...', {
        icon: 'ℹ️',
      });
      await confirmAndTrack(submittedAction);
    } catch (error) {
      if (reservation && (!walletRequestStarted || isExplicitWalletRejection(error))) {
        await releasePendingBridgeReservation(reservation);
        setPendingRecord(loadPendingBridgeRecord(actionStorageKey));
      }
      const message = error instanceof Error ? error.message : 'Transaction failed';
      setPhase(null);
      toast.error(message);
      onError?.(error);
    } finally {
      submitLockRef.current = false;
      setIsLoading(false);
    }
  }, [
    actionStorageKey,
    actionType,
    bridge.state.error,
    confirmAndTrack,
    needsSetup,
    onError,
    prepareAction,
    requestKey,
    signAndSendTransaction,
    solanaAddress,
    solanaWallet,
  ]);

  // A submitted action must always remain re-checkable. Its exact parameters
  // and message identity are already persisted, so a fresh quote is irrelevant
  // and a quote outage must never strand the pending-action lock.
  const quoteBlocksAction =
    pendingRecord === null && requiresQuote && !needsSetup && (!quoteReady || isQuoteLoading);
  const isDisabled =
    (pendingRecord === null && disabled) ||
    !isConnected ||
    !solanaWallet ||
    isLoading ||
    quoteBlocksAction;
  const pendingDisplayText = pendingRecord?.kind === 'reservation'
    ? pendingRecord.phase === 'wallet-pending'
      ? 'Recover Solana transaction'
      : 'Solana action in progress'
    : null;
  const displayText =
    !solanaWallet && isConnected
      ? 'Wallet not ready'
      : pendingDisplayText ?? getSolanaActionButtonLabel({
          connected: isConnected,
          needsImplicitSetup: needsSetup,
          pending: pendingRecord !== null,
          quoteLoading: requiresQuote && isQuoteLoading,
          quoteReady,
          requestedLabel: buttonText,
          defaultLabel: DEFAULT_LABELS[actionType],
        });

  return (
    <Button
      onClick={handleClick}
      disabled={isDisabled}
      aria-busy={isLoading}
      className={`w-full bg-[image:var(--gradient-solana)] text-white hover:brightness-105 disabled:opacity-55 ${buttonClassName}`}
    >
      {isLoading ? (
        <span className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          {phase ? PHASE_LABELS[phase] : 'Preparing transaction...'}
        </span>
      ) : (
        displayText
      )}
    </Button>
  );
}
