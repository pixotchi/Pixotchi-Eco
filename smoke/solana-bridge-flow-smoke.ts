import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  getEffectiveSolanaAction,
  getSolanaActionButtonLabel,
  getSolanaActionKey,
  getSolanaQuoteKey,
  isCurrentSolanaQuoteGeneration,
  nextSolanaQuoteGeneration,
} from '../lib/solana-bridge-flow';
import {
  acquirePendingBridgeReservation,
  clearPendingBridgeAction,
  finalizePendingBridgeReservation,
  loadPendingBridgeRecord,
  markPendingBridgeWalletRequest,
  PendingBridgeStorageUnavailableError,
  PENDING_BRIDGE_PREPARATION_STALE_MS,
  releasePendingBridgeReservation,
  recoverPendingBridgeWalletRequest,
  confirmSolanaTransaction,
  SolanaTransactionExecutionError,
  SolanaTransactionExpiredError,
  type PendingBridgeAction,
  type PendingBridgeReservation,
  type PendingBridgeStorage,
} from '../lib/solana-bridge-lifecycle';
import { BRIDGE_CONFIG } from '../lib/solana-constants';

const repoRoot = process.cwd();

class MemoryStorage implements PendingBridgeStorage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  entries() {
    return [...this.values.entries()];
  }
}

function createSubmittedAction(
  reservation: PendingBridgeReservation,
  signature: string,
): PendingBridgeAction {
  return {
    version: 2,
    kind: 'submitted',
    actionKey: reservation.actionKey,
    attemptId: reservation.attemptId,
    requestKey: reservation.requestKey,
    requestedAction: reservation.requestedAction,
    createdAt: Date.now(),
    signature,
    outgoingMessageAddress: 'outgoing-message-address',
    implicitSetup: false,
    solanaConfirmed: false,
    twinAddress: '0x0000000000000000000000000000000000000001',
    recentBlockhash: 'recent-blockhash',
    lastValidBlockHeight: 123,
  };
}

const walletMetadata = {
  outgoingMessageAddress: '11111111111111111111111111111111',
  implicitSetup: false,
  twinAddress: '0x0000000000000000000000000000000000000001',
  recentBlockhash: 'recent-blockhash',
  lastValidBlockHeight: 123,
} as const;

async function main() {

// Setup is a distinct operation and caller copy cannot disguise it as purchase success.
assert.deepEqual(getEffectiveSolanaAction('shopItem', true), {
  effectiveAction: 'setup',
  implicitSetup: true,
});
assert.deepEqual(getEffectiveSolanaAction('shopItem', false), {
  effectiveAction: 'shopItem',
  implicitSetup: false,
});
assert.equal(
  getSolanaActionButtonLabel({
    connected: true,
    needsImplicitSetup: true,
    pending: false,
    quoteLoading: false,
    quoteReady: true,
    requestedLabel: 'Buy Item',
    defaultLabel: 'Buy Item',
  }),
  'Setup Bridge Access',
);

// Quote and pending-action identities include every input that changes execution.
assert.notEqual(
  getSolanaQuoteKey('mint', { strain: 1 }),
  getSolanaQuoteKey('mint', { strain: 2 }),
);

const generationA = nextSolanaQuoteGeneration(0);
const generationB = nextSolanaQuoteGeneration(generationA);
assert.equal(isCurrentSolanaQuoteGeneration(generationB, generationB), true);
assert.equal(isCurrentSolanaQuoteGeneration(generationA, generationB), false);
assert.notEqual(
  getSolanaQuoteKey('shopItem', { itemId: 4 }),
  getSolanaQuoteKey('gardenItem', { itemId: 4 }),
);
assert.notEqual(
  getSolanaActionKey('setName', { plantId: 1, name: 'Fern' }),
  getSolanaActionKey('setName', { plantId: 1, name: 'Moss' }),
);

// confirmTransaction can resolve while carrying an InstructionError. That is a failure.
await assert.rejects(
  confirmSolanaTransaction(
    {
      confirmTransaction: async () => ({
        context: { slot: 1 },
        value: { err: { InstructionError: [0, 'Custom'] } },
      }),
      getSignatureStatuses: async () => ({ context: { slot: 1 }, value: [null] }),
    },
    'failed-signature',
  ),
  SolanaTransactionExecutionError,
);

await assert.rejects(
  confirmSolanaTransaction(
    {
      confirmTransaction: async () => { throw new Error('subscription unavailable'); },
      getSignatureStatuses: async () => ({ context: { slot: 3 }, value: [null] }),
      getBlockHeight: async () => 11,
      getAccountInfo: async () => null,
    },
    'expired-signature',
    {
      timeoutMs: 10,
      pollMs: 1,
      blockhash: 'recent-blockhash',
      lastValidBlockHeight: 10,
      outgoingMessageAddress: '11111111111111111111111111111111',
    },
  ),
  SolanaTransactionExpiredError,
);

// A blockheight-expired subscription is not authoritative when historical
// signature evidence says the transaction actually finalized. This exact race
// previously cleared the durable record and exposed a duplicate-send path.
let expiredButLandedStatusReads = 0;
await confirmSolanaTransaction(
  {
    confirmTransaction: async () => { throw new Error('block height exceeded'); },
    getSignatureStatuses: async () => {
      expiredButLandedStatusReads += 1;
      return {
        context: { slot: 12 },
        value: [{
          slot: 12,
          confirmations: null,
          err: null,
          confirmationStatus: 'finalized' as const,
        }],
      };
    },
    getBlockHeight: async () => 12,
    getAccountInfo: async () => null,
  },
  'expired-but-landed-signature',
  {
    timeoutMs: 10,
    pollMs: 1,
    blockhash: 'recent-blockhash',
    lastValidBlockHeight: 10,
    outgoingMessageAddress: '11111111111111111111111111111111',
  },
);
assert.ok(expiredButLandedStatusReads > 0);

await assert.rejects(
  confirmSolanaTransaction(
    {
      confirmTransaction: async () => { throw new Error('subscription unavailable'); },
      getSignatureStatuses: async () => ({
        context: { slot: 2 },
        value: [{
          slot: 2,
          confirmations: 1,
          err: { InstructionError: [0, 'Custom'] },
          confirmationStatus: 'confirmed',
        }],
      }),
    },
    'failed-poll-signature',
    { timeoutMs: 10, pollMs: 1 },
  ),
  SolanaTransactionExecutionError,
);

let observedPhase = '';
await confirmSolanaTransaction(
  {
    confirmTransaction: async () => ({
      context: { slot: 1 },
      value: { err: null },
    }),
    getSignatureStatuses: async () => ({ context: { slot: 1 }, value: [null] }),
  },
  'successful-signature',
  { onPhase: (phase) => { observedPhase = phase; } },
);
assert.equal(observedPhase, 'solana-confirmed');

// Two independent tab/component controllers share durable admission state. The
// loser never reaches sign/send, while the winner atomically replaces its
// padded reservation at the same physical key with submitted proof.
const sharedStorage = new MemoryStorage();
const actionKey = 'solana-wallet-a:active';
let signCalls = 0;
let sendCalls = 0;
const runContender = async (tab: string, attemptId: string) => {
  const admission = await acquirePendingBridgeReservation({
    actionKey,
    requestKey: 'mint:strain=1',
    requestedAction: 'mint',
    storage: sharedStorage,
    attemptId,
    settleMs: 10,
    processFenceKey: tab,
  });
  if (!admission.acquired) return false;
  const walletPending = await markPendingBridgeWalletRequest(
    admission.reservation,
    walletMetadata,
    sharedStorage,
    0,
  );
  assert.ok(walletPending);
  const persistedWalletPending = loadPendingBridgeRecord(actionKey, sharedStorage);
  assert.equal(persistedWalletPending?.kind, 'reservation');
  assert.equal(
    persistedWalletPending?.kind === 'reservation'
      ? persistedWalletPending.outgoingMessageAddress
      : null,
    walletMetadata.outgoingMessageAddress,
  );
  signCalls += 1;
  sendCalls += 1;
  const submitted = createSubmittedAction(walletPending, 'submitted-signature');
  assert.equal(
    await finalizePendingBridgeReservation(walletPending, submitted, sharedStorage, 0),
    true,
  );
  return true;
};

const contenderResults = await Promise.all([
  runContender('tab-a', 'attempt-tab-a'),
  runContender('tab-b', 'attempt-tab-b'),
]);
assert.equal(contenderResults.filter(Boolean).length, 1);
assert.equal(signCalls, 1);
assert.equal(sendCalls, 1);
const storedSubmitted = loadPendingBridgeRecord(actionKey, sharedStorage);
assert.equal(storedSubmitted?.kind, 'submitted');
assert.equal(
  sharedStorage.entries().filter(([key]) => key.includes(':record:')).length,
  1,
);

// Submitted bridge proof cannot age out: a relay-failed transaction may still
// be retried and settle on Base well after the old 24-hour UI horizon.
const [submittedStorageKey, submittedRaw] = sharedStorage.entries()
  .find(([key]) => key.includes(':record:'))!;
sharedStorage.setItem(
  submittedStorageKey,
  JSON.stringify({
    ...(JSON.parse(submittedRaw) as PendingBridgeAction),
    createdAt: Date.now() - BRIDGE_CONFIG.pendingActionMaxAgeMs - 1,
  }),
);
assert.equal(loadPendingBridgeRecord(actionKey, sharedStorage)?.kind, 'submitted');
const agedSubmittedContender = await acquirePendingBridgeReservation({
  actionKey,
  requestKey: 'mint:strain=1',
  requestedAction: 'mint',
  storage: sharedStorage,
  attemptId: 'aged-duplicate-attempt',
  settleMs: 0,
});
assert.equal(agedSubmittedContender.acquired, false);
assert.equal(agedSubmittedContender.blocker?.kind, 'submitted');

// Terminal proof is consumed by exact CAS. Concurrent monitors may both see
// Base success, but only the deletion winner owns user callbacks/refreshes.
const terminalStorage = new MemoryStorage();
const terminalAdmission = await acquirePendingBridgeReservation({
  actionKey: 'solana-wallet-terminal:active',
  requestKey: 'claim:plant=7',
  requestedAction: 'claimRewards',
  storage: terminalStorage,
  attemptId: 'terminal-attempt',
  settleMs: 0,
});
assert.ok(terminalAdmission.acquired);
const terminalWalletPending = await markPendingBridgeWalletRequest(
  terminalAdmission.reservation,
  walletMetadata,
  terminalStorage,
  0,
);
assert.ok(terminalWalletPending);
const terminalAction = createSubmittedAction(terminalWalletPending, 'terminal-signature');
assert.equal(
  await finalizePendingBridgeReservation(
    terminalWalletPending,
    terminalAction,
    terminalStorage,
    0,
  ),
  true,
);
const terminalOwners = await Promise.all([
  clearPendingBridgeAction(terminalAction, terminalStorage, 0),
  clearPendingBridgeAction(terminalAction, terminalStorage, 0),
]);
assert.equal(terminalOwners.filter(Boolean).length, 1);

// A deterministic preparation failure releases only its own attempt and a
// later retry can acquire normally.
const failureStorage = new MemoryStorage();
const failedAdmission = await acquirePendingBridgeReservation({
  actionKey: 'solana-wallet-b:active',
  requestKey: 'shop:item=4',
  requestedAction: 'shopItem',
  storage: failureStorage,
  attemptId: 'failed-attempt',
  settleMs: 0,
});
assert.equal(failedAdmission.acquired, true);
assert.ok(failedAdmission.acquired);
assert.equal(
  await releasePendingBridgeReservation(failedAdmission.reservation, failureStorage, 0),
  true,
);
assert.equal(loadPendingBridgeRecord('solana-wallet-b:active', failureStorage), null);
const retryAdmission = await acquirePendingBridgeReservation({
  actionKey: 'solana-wallet-b:active',
  requestKey: 'shop:item=4',
  requestedAction: 'shopItem',
  storage: failureStorage,
  attemptId: 'retry-attempt',
  settleMs: 0,
});
assert.equal(retryAdmission.acquired, true);

// A crashed pre-wallet reservation becomes safely supersedable. Admission
// prunes the exact stale padded record before writing its successor, preventing
// repeated crashes from exhausting localStorage; the old owner still cannot
// delete the successor record.
const staleStorage = new MemoryStorage();
const staleAdmission = await acquirePendingBridgeReservation({
  actionKey: 'solana-wallet-c:active',
  requestKey: 'set-name:old',
  requestedAction: 'setName',
  storage: staleStorage,
  attemptId: 'stale-attempt',
  createdAt: Date.now() - PENDING_BRIDGE_PREPARATION_STALE_MS - 1,
  settleMs: 0,
});
assert.equal(staleAdmission.acquired, true);
assert.ok(staleAdmission.acquired);
const successorAdmission = await acquirePendingBridgeReservation({
  actionKey: 'solana-wallet-c:active',
  requestKey: 'set-name:new',
  requestedAction: 'setName',
  storage: staleStorage,
  attemptId: 'successor-attempt',
  settleMs: 0,
});
assert.equal(successorAdmission.acquired, true);
assert.ok(successorAdmission.acquired);
assert.equal(
  staleStorage.entries().filter(([key]) => key.includes(':record:')).length,
  1,
);
assert.equal(
  await markPendingBridgeWalletRequest(
    staleAdmission.reservation,
    walletMetadata,
    staleStorage,
    0,
  ),
  null,
);
assert.equal(
  await releasePendingBridgeReservation(staleAdmission.reservation, staleStorage, 0),
  false,
);
assert.equal(
  loadPendingBridgeRecord('solana-wallet-c:active', staleStorage)?.attemptId,
  successorAdmission.reservation.attemptId,
);

// Once wallet entry begins, losing the tab is ambiguous: even a very old
// reservation remains a blocker instead of silently permitting a duplicate.
const ambiguousStorage = new MemoryStorage();
const ambiguousAdmission = await acquirePendingBridgeReservation({
  actionKey: 'solana-wallet-ambiguous:active',
  requestKey: 'mint:strain=3',
  requestedAction: 'mint',
  storage: ambiguousStorage,
  attemptId: 'ambiguous-attempt',
  settleMs: 0,
});
assert.ok(ambiguousAdmission.acquired);
const ambiguousWalletPending = await markPendingBridgeWalletRequest(
  ambiguousAdmission.reservation,
  walletMetadata,
  ambiguousStorage,
  0,
);
assert.ok(ambiguousWalletPending);
const [ambiguousKey] = ambiguousStorage.entries().find(([key]) => key.includes(':record:'))!;
ambiguousStorage.setItem(
  ambiguousKey,
  JSON.stringify({
    ...ambiguousWalletPending,
    createdAt: Date.now() - BRIDGE_CONFIG.pendingActionMaxAgeMs - 1,
  }),
);
const blockedByAmbiguousWallet = await acquirePendingBridgeReservation({
  actionKey: 'solana-wallet-ambiguous:active',
  requestKey: 'mint:strain=3',
  requestedAction: 'mint',
  storage: ambiguousStorage,
  attemptId: 'duplicate-attempt',
  settleMs: 0,
});
assert.equal(blockedByAmbiguousWallet.acquired, false);
assert.equal(blockedByAmbiguousWallet.blocker?.kind, 'reservation');
assert.equal(
  blockedByAmbiguousWallet.blocker?.kind === 'reservation'
    ? blockedByAmbiguousWallet.blocker.phase
    : null,
  'wallet-pending',
);

// A wallet response lost after broadcast is recovered from the precomputed
// outgoing address's signature history, without invoking another send.
const landedStorage = new MemoryStorage();
const landedAdmission = await acquirePendingBridgeReservation({
  actionKey: 'solana-wallet-landed:active',
  requestKey: 'mint:strain=4',
  requestedAction: 'mint',
  storage: landedStorage,
  attemptId: 'landed-attempt',
  settleMs: 0,
});
assert.ok(landedAdmission.acquired);
const landedWalletPending = await markPendingBridgeWalletRequest(
  landedAdmission.reservation,
  walletMetadata,
  landedStorage,
  0,
);
assert.ok(landedWalletPending);
const sendsBeforeRecovery = sendCalls;
const landedRecovery = await recoverPendingBridgeWalletRequest(
  landedWalletPending,
  {
    getAccountInfo: async () => ({}) as never,
    getBlockHeight: async () => walletMetadata.lastValidBlockHeight,
    getSignaturesForAddress: async () => [{
      blockTime: null,
      confirmationStatus: 'confirmed',
      err: null,
      memo: null,
      signature: 'recovered-landed-signature',
      slot: 42,
    }],
  },
  landedStorage,
);
assert.equal(landedRecovery.status, 'submitted');
assert.equal(loadPendingBridgeRecord('solana-wallet-landed:active', landedStorage)?.kind, 'submitted');
assert.equal(sendCalls, sendsBeforeRecovery);

// Expiry is safe to clear only after both account and signature-history reads
// prove absence. The retry remains a separate user click.
const expiredStorage = new MemoryStorage();
const expiredAdmission = await acquirePendingBridgeReservation({
  actionKey: 'solana-wallet-expired:active',
  requestKey: 'mint:strain=5',
  requestedAction: 'mint',
  storage: expiredStorage,
  attemptId: 'expired-attempt',
  settleMs: 0,
});
assert.ok(expiredAdmission.acquired);
const expiredWalletPending = await markPendingBridgeWalletRequest(
  expiredAdmission.reservation,
  walletMetadata,
  expiredStorage,
  0,
);
assert.ok(expiredWalletPending);
const expiredRecovery = await recoverPendingBridgeWalletRequest(
  expiredWalletPending,
  {
    getAccountInfo: async () => null,
    getBlockHeight: async () => walletMetadata.lastValidBlockHeight + 1,
    getSignaturesForAddress: async () => [],
  },
  expiredStorage,
);
assert.deepEqual(expiredRecovery, { status: 'cleared', reason: 'expired-absent' });
assert.equal(loadPendingBridgeRecord('solana-wallet-expired:active', expiredStorage), null);

// Any unavailable evidence source keeps the reservation blocking, even after
// the nominal blockhash window has passed.
const uncertainStorage = new MemoryStorage();
const uncertainAdmission = await acquirePendingBridgeReservation({
  actionKey: 'solana-wallet-uncertain:active',
  requestKey: 'mint:strain=6',
  requestedAction: 'mint',
  storage: uncertainStorage,
  attemptId: 'uncertain-attempt',
  settleMs: 0,
});
assert.ok(uncertainAdmission.acquired);
const uncertainWalletPending = await markPendingBridgeWalletRequest(
  uncertainAdmission.reservation,
  walletMetadata,
  uncertainStorage,
  0,
);
assert.ok(uncertainWalletPending);
const uncertainRecovery = await recoverPendingBridgeWalletRequest(
  uncertainWalletPending,
  {
    getAccountInfo: async () => { throw new Error('RPC unavailable'); },
    getBlockHeight: async () => walletMetadata.lastValidBlockHeight + 100,
    getSignaturesForAddress: async () => [],
  },
  uncertainStorage,
);
assert.deepEqual(uncertainRecovery, { status: 'pending', reason: 'ambiguous' });
assert.equal(
  loadPendingBridgeRecord('solana-wallet-uncertain:active', uncertainStorage)?.kind,
  'reservation',
);

// Restricted or non-enumerable storage fails closed before preparation.
const unavailableStorage = {
  get length(): number { throw new Error('blocked'); },
  getItem() { throw new Error('blocked'); },
  key() { throw new Error('blocked'); },
  removeItem() { throw new Error('blocked'); },
  setItem() { throw new Error('blocked'); },
} satisfies PendingBridgeStorage;
await assert.rejects(
  acquirePendingBridgeReservation({
    actionKey: 'solana-wallet-d:active',
    requestKey: 'mint:strain=2',
    requestedAction: 'mint',
    storage: unavailableStorage,
    settleMs: 0,
  }),
  PendingBridgeStorageUnavailableError,
);

const mintSource = readFileSync(resolve(repoRoot, 'components/tabs/mint-tab.tsx'), 'utf8');
const buttonSource = readFileSync(
  resolve(repoRoot, 'components/transactions/solana-bridge-button.tsx'),
  'utf8',
);
const executorSource = readFileSync(resolve(repoRoot, 'lib/solana-bridge-executor.ts'), 'utf8');
const serviceSource = readFileSync(resolve(repoRoot, 'lib/solana-bridge-service.ts'), 'utf8');

// UI callers cannot reconstruct a bridge transaction and accidentally drop gasLimit.
assert.equal(mintSource.includes('createBridgeTransaction('), false);
assert.equal(buttonSource.includes('createBridgeTransaction('), false);
assert.match(executorSource, /gasLimit:\s*params\.gasLimit/);
assert.equal(BRIDGE_CONFIG.complexGasLimit, BigInt(3_000_000));
assert.match(serviceSource, /gasLimit:\s*BRIDGE_CONFIG\.complexGasLimit/);

// Breakpoints only change CSS visibility; they never select a different controller tree.
assert.equal(mintSource.includes('window.matchMedia'), false);
assert.equal(mintSource.includes('useCombinedMintLayout'), false);
assert.equal(mintSource.includes("balances:refresh"), false);
assert.match(mintSource, /Both EVM transaction controllers stay mounted/);
assert.equal((mintSource.match(/<ApprovalActionTransaction/g) ?? []).length, 2);
assert.match(buttonSource, /pendingRecord === null && requiresQuote/);
assert.ok(
  buttonSource.indexOf('const admission = await acquirePendingBridgeReservation')
    < buttonSource.indexOf('const tx = await prepareAction()'),
);
assert.ok(
  buttonSource.indexOf('const walletPendingReservation = await markPendingBridgeWalletRequest')
    < buttonSource.indexOf('await signAndSendTransaction'),
);
assert.ok(
  buttonSource.indexOf('const recovery = await recoverPendingBridgeWalletRequest')
    < buttonSource.indexOf('const admission = await acquirePendingBridgeReservation'),
);
assert.match(buttonSource, /outgoingMessageAddress:\s*metadata\.outgoingMessageAddress/);
assert.match(buttonSource, /recentBlockhash:\s*metadata\.recentBlockhash/);
assert.match(buttonSource, /lastValidBlockHeight:\s*metadata\.lastValidBlockHeight/);
assert.match(buttonSource, /outgoingMessageAddress:\s*currentAction\.outgoingMessageAddress/);
assert.equal((buttonSource.match(/const ownsTerminal = await clearPendingBridgeAction/g) ?? []).length, 2);
assert.match(buttonSource, /if \(!ownsTerminal\) \{/);
assert.ok(
  buttonSource.indexOf('const ownsTerminal = await clearPendingBridgeAction')
    < buttonSource.indexOf('await refresh()'),
);
assert.equal(buttonSource.includes('savePendingBridgeAction'), false);

  console.log('Solana bridge flow smoke checks passed');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
