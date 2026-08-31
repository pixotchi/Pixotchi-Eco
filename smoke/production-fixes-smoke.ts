import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  encodeAbiParameters,
  keccak256,
  numberToHex,
  padHex,
  parseAbiParameters,
  stringToHex,
  toBytes,
  type Hex,
  type TransactionReceipt,
} from 'viem';
import { extractBestSpinRewardFromLogs } from '../lib/spin-game-events';
import { onBalanceRefresh } from '../lib/app-events';
import { waitForCanonicalBaseReceipt } from '../lib/base-rpc';
import {
  BASE_RPC_MAX_BATCH_SIZE,
  BASE_RPC_MAX_BODY_BYTES,
  BASE_RPC_MAX_MULTICALL_CALLDATA_BYTES,
} from '../lib/base-rpc-policy';
import {
  createLandTransferCall,
  createNftOperatorApprovalCall,
  createPlantTransferCall,
  createRouterBatchTransferCall,
} from '../lib/contracts';
import { dispatchPostTransactionRefresh } from '../lib/transaction-refresh';
import {
  computeMarketplaceAmountAsk,
  formatMarketplacePriceRatio,
  getMarketplacePriceRatio,
} from '../lib/marketplace-price';
import {
  PENDING_EVM_AMBIGUOUS_ACK_LOCK_MS,
  PENDING_EVM_HARD_LOCK_MS,
  PENDING_EVM_MAX_RECORD_SIZE,
  PENDING_EVM_PROXY_NOT_FORWARDED_MARKER,
  acknowledgePendingEvmRecord,
  canDurablyPersistPendingEvmTransactions,
  createPendingEvmCallsDigest,
  createPendingEvmRecord,
  finalizePendingEvmRecord,
  getPendingEvmCompatibility,
  getPendingEvmIntentDigest,
  getPendingEvmPhase,
  getPendingEvmStorageKey,
  isDefinitivePendingEvmPreSubmissionError,
  isDefinitiveUnsupportedEvmBatchError,
  readPendingEvmRecord,
  removePendingEvmRecord,
  resumePendingEvmRecord,
  withPendingEvmSubmissionGuard,
  withPendingEvmSubmissionLease,
  writePendingEvmRecord,
  type PendingEvmStorage,
} from '../lib/pending-evm-transaction';

const projectFile = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const PREVIOUS_PENDING_EVM_AUTO_PRUNE_MS = 24 * 60 * 60 * 1_000;

class MemoryStorage implements PendingEvmStorage {
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
}

class RemovalFailStorage extends MemoryStorage {
  failRemoval = false;

  override removeItem(key: string) {
    if (this.failRemoval) throw new Error('removal blocked');
    super.removeItem(key);
  }
}

class FinalizeFailStorage extends MemoryStorage {
  failProofWrite = false;

  override setItem(key: string, value: string) {
    if (this.failProofWrite && value.length < 3_500) {
      throw new Error('proof write blocked');
    }
    super.setItem(key, value);
  }
}

class MidEnumerationThrowStorage extends MemoryStorage {
  private enumerationPass = 0;

  override key(index: number) {
    if (index === 0) this.enumerationPass += 1;
    // Guard setup performs three complete scans: the durable probe, then the
    // submission-lease scans before and after its claim. Interrupt only the
    // pending-record registry scan that follows them.
    if (this.enumerationPass === 4 && index === 1) {
      throw new Error('registry enumeration interrupted');
    }
    return super.key(index);
  }
}

class CandidateReadThrowStorage extends MemoryStorage {
  unreadableKey: string | null = null;

  override getItem(key: string) {
    if (key === this.unreadableKey) {
      throw new Error('pending record read interrupted');
    }
    return super.getItem(key);
  }
}

class RegistryShiftStorage extends MemoryStorage {
  private claimReads = 0;
  private enumerationsAfterArm = 0;
  private mutated = false;

  constructor(
    private readonly shiftingKey: string,
    private readonly replacementKey: string | null,
  ) {
    super();
  }

  override getItem(key: string) {
    const value = super.getItem(key);
    if (
      value !== null
      && key.includes('pixotchi:pending-evm:v2:lease:')
      && key.includes(':claim:')
    ) {
      this.claimReads += 1;
    }
    return value;
  }

  override key(index: number) {
    if (index === 0 && this.claimReads >= 2 && !this.mutated) {
      this.enumerationsAfterArm += 1;
    }
    const key = super.key(index);
    // The first enumeration after the lease candidate read is that helper's
    // validation pass. Mutate on the next one: the registry's first capture.
    if (
      index === 0
      && this.enumerationsAfterArm === 2
      && !this.mutated
      && key === this.shiftingKey
    ) {
      super.removeItem(key);
      if (this.replacementKey) super.setItem(this.replacementKey, 'replacement');
      this.mutated = true;
    }
    return key;
  }
}

class LeaseClaimShiftStorage extends MemoryStorage {
  private armed = false;
  private currentShiftingKey: string;
  private shiftIndex = 1;

  constructor(
    firstShiftingKey: string,
    private readonly incumbentClaimKey: string,
  ) {
    super();
    this.currentShiftingKey = firstShiftingKey;
  }

  arm() {
    this.armed = true;
  }

  override key(index: number) {
    const key = super.key(index);
    const hasProbe = Array.from({ length: this.length }, (_, keyIndex) => (
      super.key(keyIndex)
    )).some((storedKey) => storedKey?.includes(':probe:'));
    if (
      index === 0
      && this.armed
      && !hasProbe
      && key === this.currentShiftingKey
    ) {
      super.removeItem(key);
      this.shiftIndex += 1;
      this.currentShiftingKey = `smoke:lease-shift-unrelated-${this.shiftIndex}`;
      super.setItem(this.currentShiftingKey, 'unrelated');
    }
    return key;
  }

  override setItem(key: string, value: string) {
    const isOwnClaim = this.armed
      && key.includes(':claim:')
      && key !== this.incumbentClaimKey;
    if (!isOwnClaim) {
      super.setItem(key, value);
      return;
    }

    // If an unsafe fixed-index before-scan missed the incumbent, arrange the
    // after-write scan so the same shift would omit it again.
    const shiftingValue = super.getItem(this.currentShiftingKey);
    const incumbentValue = super.getItem(this.incumbentClaimKey);
    if (shiftingValue !== null && incumbentValue !== null) {
      super.removeItem(this.currentShiftingKey);
      super.removeItem(this.incumbentClaimKey);
      super.setItem(this.currentShiftingKey, shiftingValue);
      super.setItem(this.incumbentClaimKey, incumbentValue);
    }
    super.setItem(key, value);
  }
}

class ReplaceValueOnReadStorage extends MemoryStorage {
  private targetReads = 0;

  constructor(
    private readonly targetKey: string,
    private readonly replacementValue: string,
    private readonly replaceOnRead: number,
  ) {
    super();
  }

  override getItem(key: string) {
    if (key === this.targetKey) {
      this.targetReads += 1;
      if (this.targetReads === this.replaceOnRead) {
        super.setItem(key, this.replacementValue);
      }
    }
    return super.getItem(key);
  }
}

class AdvanceClockOnClaimStorage extends MemoryStorage {
  advanced = false;

  constructor(private readonly advanceClock: () => void) {
    super();
  }

  override setItem(key: string, value: string) {
    super.setItem(key, value);
    if (!this.advanced && key.includes(':claim:')) {
      this.advanced = true;
      this.advanceClock();
    }
  }
}

const spinPlayedTopic = keccak256(
  toBytes('SpinGameV2Played(uint256,address,uint256,int256,uint256,uint256)'),
);
const topicUint = (value: bigint) => padHex(numberToHex(value), { size: 32 });
const topicAddress = (value: Hex) => padHex(value, { size: 32 });

const currentSpinLog = {
  topics: [
    spinPlayedTopic,
    topicUint(BigInt(21_944)),
    topicAddress('0x000000000000000000000000000000000000c0de'),
    topicUint(BigInt(5)),
  ],
  data: encodeAbiParameters(
    parseAbiParameters('int256 pointsDelta, uint256 timeAdded, uint256 leafAmount'),
    [BigInt(12), BigInt(3_600), BigInt('1000000000000000000')],
  ),
};

const currentSpinResult = extractBestSpinRewardFromLogs([currentSpinLog]);
assert.deepEqual(currentSpinResult, {
  rewardIndex: 5,
  pointsDelta: 12,
  timeAdded: 3_600,
  leafAmount: BigInt('1000000000000000000'),
});

const legacySpinLog = {
  topics: [
    spinPlayedTopic,
    topicUint(BigInt(21_944)),
    topicAddress('0x000000000000000000000000000000000000c0de'),
  ],
  data: encodeAbiParameters(
    parseAbiParameters('uint256 rewardIndex, int256 pointsDelta, uint256 timeAdded, uint256 leafAmount'),
    [BigInt(2), -BigInt(5), BigInt(7_200), BigInt(0)],
  ),
};

const legacySpinResult = extractBestSpinRewardFromLogs([legacySpinLog]);
assert.deepEqual(legacySpinResult, {
  rewardIndex: 2,
  pointsDelta: -5,
  timeAdded: 7_200,
  leafAmount: BigInt(0),
});

const leaderboard = projectFile('components/tabs/leaderboard-tab.tsx');
assert.match(leaderboard, /\(didWin \? toast\.success : toast\.error\)/);
assert.doesNotMatch(leaderboard, /toast\.success\('Attack confirmed!'/);
assert.match(leaderboard, /Attack confirmed\. Check Activity for the result\./);

const arcade = projectFile('components/arcade/ArcadeDialog.tsx');
assert.equal((arcade.match(/feedbackMode="toast"/g) || []).length, 3);
assert.equal((arcade.match(/feedbackMode="inline"/g) || []).length, 1);
assert.match(arcade, /Recover SpinLeaf commit/);
assert.doesNotMatch(arcade, /showToast=\{false\}/);
assert.match(arcade, /surface-scroll-fade flex-1 overflow-y-auto py-3 pr-1/);

const dialogUi = projectFile('components/ui/dialog.tsx');
assert.match(dialogUi, /sticky && "surface-footer-divider dialog-footer-surface sticky[\s\S]*pt-3/);
assert.match(dialogUi, /surface-scroll-fade[\s\S]*min-h-0[\s\S]*flex-1[\s\S]*overflow-y-auto[\s\S]*py-3/);

const tasksInfoDialog = projectFile('components/tasks/TasksInfoDialog.tsx');
assert.match(tasksInfoDialog, /data-task-summary-card/);
// The summary card no longer escapes the header padding with a negative
// margin (that hack depended on DialogContent clipping and broke centring
// whenever header padding changed).
assert.doesNotMatch(tasksInfoDialog, /mr-\[-2\.75rem\]/);
assert.match(tasksInfoDialog, /<DialogDescription className="leading-relaxed">[\s\S]*\{!effectiveDisabled && summaryCard\}[\s\S]*<\/DialogHeader>/);
assert.doesNotMatch(tasksInfoDialog, /sticky top-3 z-10/);
assert.doesNotMatch(tasksInfoDialog, /sticky top-0 z-10/);
assert.match(tasksInfoDialog, /<DialogBody className="space-y-4 pr-1">/);

const premiumUi = projectFile('components/ui/premium.tsx');
// ActionBar (a byte-for-byte copy of DialogFooter sticky) was removed; the
// dialog.tsx assertion above covers the one canonical sticky footer.
assert.doesNotMatch(premiumUi, /ActionBar/);

const marketplaceDialog = projectFile('components/transactions/marketplace-dialog.tsx');
assert.match(marketplaceDialog, /surface-scroll-fade flex-1 overflow-y-auto py-3 pr-1/);
assert.equal((marketplaceDialog.match(/<Input\b/g) || []).length, 2);
assert.equal((marketplaceDialog.match(/buttonText="Create Order"/g) || []).length, 1);
assert.match(marketplaceDialog, /htmlFor=\{amountInputId\}/);
assert.match(marketplaceDialog, /htmlFor=\{priceInputId\}/);
assert.match(marketplaceDialog, /onBalanceRefresh/);
assert.doesNotMatch(marketplaceDialog, /refreshBalancesAndAllowances/);
assert.doesNotMatch(marketplaceDialog, /addEventListener\(['"]balances:refresh/);
assert.doesNotMatch(marketplaceDialog, /setTimeout\(\(\) => fetchBalances/);
assert.match(marketplaceDialog, /setExactPriceRatio\(row\.exactRatio\)/);
assert.match(marketplaceDialog, /computeMarketplaceAmountAsk\(sellSide, parsedAmount, exactPriceRatio\)/);
assert.match(marketplaceDialog, /onChange=\{\(event\) => \{\s*setExactPriceRatio\(null\);\s*setPrice\(event\.target\.value\);/);

// Active order #1792: 29 LEAF for 10,000,000 SEED is exactly 0.0000029.
// The old six-decimal preset produced 30 LEAF; the selected raw ratio must
// recreate the original 29 LEAF calldata amount exactly.
const marketplaceScale = BigInt(10) ** BigInt(18);
const marketplaceRatio = getMarketplacePriceRatio({
  amount: BigInt(29) * marketplaceScale,
  amountAsk: BigInt(10_000_000) * marketplaceScale,
  sellToken: 1,
});
assert.ok(marketplaceRatio);
assert.equal(formatMarketplacePriceRatio(marketplaceRatio), '0.0000029');
assert.equal(
  computeMarketplaceAmountAsk(
    'SEED',
    BigInt(10_000_000) * marketplaceScale,
    marketplaceRatio,
  ),
  BigInt(29) * marketplaceScale,
);

const landsView = projectFile('components/tabs/lands-view.tsx');
const landsViewSource = landsView;
const plantsViewSource = projectFile('components/tabs/plants-view.tsx');
// A superseded land request must not consume or replay the selected land's
// queued building refresh. The queue carries the same full identity as the
// pending slot, and only the exact owner may drain it.
assert.match(landsView, /type BuildingFetchIdentity = \{[\s\S]*buildingType: BuildingType;[\s\S]*generation: number;[\s\S]*landId: bigint;[\s\S]*ownerKey: string;[\s\S]*requestGeneration: number;/);
assert.match(landsView, /requestGeneration: \+\+buildingFetchRequestGenerationRef\.current/);
assert.match(landsView, /left\.requestGeneration === right\.requestGeneration/);
assert.match(landsView, /fetchBuildingDataQueuedRef = useRef<BuildingFetchIdentity \| null>\(null\)/);
assert.match(landsView, /if \(ownsPendingSlot\) \{[\s\S]{0,400}const queuedIdentity = fetchBuildingDataQueuedRef\.current/);
assert.match(landsView, /buildingFetchIdentityMatches\(queuedIdentity, requestIdentity\)[\s\S]{0,300}selectedLandIdRef\.current === landId/);
assert.match(landsView, /buildingFetchIdentityMatches\(fetchBuildingDataPendingRef\.current, requestIdentity\)[\s\S]{0,300}selectedLandIdRef\.current === landId/);
assert.doesNotMatch(landsView, /fetchBuildingDataQueuedRef = useRef\(false\)/);
// A post-approval refresh that races the initial allowance read must get one
// exact-owner trailing pass; stale owners/generations cannot commit or drain it.
assert.match(landsView, /fetchApprovalStatusQueuedRef = useRef<ApprovalFetchIdentity \| null>\(null\)/);
assert.match(landsView, /approvalFetchIdentityMatches\(fetchApprovalStatusPendingRef\.current, requestIdentity\)[\s\S]{0,160}fetchApprovalStatusQueuedRef\.current = requestIdentity/);
assert.match(landsView, /const queuedIdentity = fetchApprovalStatusQueuedRef\.current;[\s\S]{0,500}ownerGenerationRef\.current === requestIdentity\.generation[\s\S]{0,300}void fetchApprovalStatus\(\)/);

// --- Owner-scoped onchain lists render straight from the query cache ---------
//
// Regression fence for the "No Lands Yet! / No Plants Yet! while the data sits
// in the cache" class of bug. Plants and Lands each used to copy a fetchQuery
// result into useState behind an abort guard, and re-arm a 30s timestamp that
// gated the only retry. A cleanup that fires without a real unmount -- React
// StrictMode in dev, and <Activity mode="hidden"> on any top-level tab switch --
// aborted the in-flight read, so the copy step dropped a result that had already
// landed in the cache while its finally block still cleared `loading`. The view
// settled on the empty state and could not refetch for 30 seconds.
//
// The fix is structural: nothing copies query data into component state. Assert
// that neither view has grown a second source of truth again.
const ownerResourceList = projectFile('hooks/useOwnerResourceList.ts');
assert.match(
  ownerResourceList,
  /const query = useQuery<TItem\[\]>\(\{/,
  'owner-scoped lists must be rendered by a live query observer, not copied into state',
);
assert.match(
  ownerResourceList,
  /queryClient\.fetchQuery<TItem\[\]>\(\{/,
  'reconciliation must write through the cache so a cancelled pass cannot discard data',
);
assert.match(
  ownerResourceList,
  /refetchOnWindowFocus: true/,
  'owner lists must refresh on focus; stale onchain state is the failure mode here',
);

for (const [label, source] of [
  ['plants-view', plantsViewSource],
  ['lands-view', landsViewSource],
] as const) {
  assert.match(
    source,
    /useOwnerResourceList</,
    `${label} must read its owner list through the shared query-backed hook`,
  );
  assert.doesNotMatch(
    source,
    /controller\.signal\.aborted/,
    `${label} must not gate committing a completed owner read on an abort flag`,
  );
  assert.doesNotMatch(
    source,
    /lastVisibleFetchRef/,
    `${label} must not re-introduce a timestamp guard that can be burned by a discarded read`,
  );
  assert.doesNotMatch(
    source,
    /Date\.now\(\) - \w+\.current > 30_000/,
    `${label} must not re-introduce a 30s lockout on the owner list refetch`,
  );
}

// The land list must stay derived from the query, never mirrored into state.
assert.doesNotMatch(landsViewSource, /setLands\(/);
assert.doesNotMatch(landsViewSource, /setSelectedLand\(/);
assert.doesNotMatch(plantsViewSource, /setPlants\(/);
assert.doesNotMatch(plantsViewSource, /setSelectedPlant\(/);

// --- Browser batching may never exceed what the proxy accepts ----------------
//
// The proxy rejects an oversized batch as a whole, so a client cap above the
// server cap turns every call in that batch into a single HTTP 400 with no
// per-call failover available.
const baseRpcSource = projectFile('lib/base-rpc.ts');
const rpcProxySource = projectFile('app/api/rpc/route.ts');
const rpcRouteSource = projectFile('app/api/rpc/route.ts');
assert.match(
  baseRpcSource,
  /const HTTP_BATCH_SIZE = IS_BROWSER \? BASE_RPC_MAX_BATCH_SIZE : UPSTREAM_HTTP_BATCH_SIZE;/,
  'the browser batcher must be capped by the shared proxy limit',
);
assert.match(
  rpcRouteSource,
  /const MAX_BATCH_SIZE = BASE_RPC_MAX_BATCH_SIZE;/,
  'the proxy must use the shared batch limit rather than its own literal',
);
assert.equal(BASE_RPC_MAX_BATCH_SIZE, 20);

// The body cap is the same defect one layer down: the browser batcher's own
// worst case (20 requests x hex-encoded multicall calldata) has to fit, or a
// busy screen produces a request the proxy rejects wholesale with HTTP 413.
const worstCaseClientBody =
  BASE_RPC_MAX_BATCH_SIZE * (BASE_RPC_MAX_MULTICALL_CALLDATA_BYTES * 2 + 2);
assert.ok(
  BASE_RPC_MAX_BODY_BYTES >= worstCaseClientBody,
  `proxy body cap ${BASE_RPC_MAX_BODY_BYTES} must cover the client worst case ${worstCaseClientBody}`,
);
assert.match(
  rpcProxySource,
  /const MAX_BODY_BYTES = BASE_RPC_MAX_BODY_BYTES;/,
  'the proxy body cap must be derived from the shared batching envelope',
);
assert.match(
  baseRpcSource,
  /const MULTICALL_BATCH_SIZE = BASE_RPC_MAX_MULTICALL_CALLDATA_BYTES;/,
  'multicall sizing must come from the shared envelope the body cap is derived from',
);

// A provider that refuses the method outright cannot have executed it, so the
// reservation must be released rather than locking the wallet. transaction-kit
// recovers via its batch->direct fallback; the swap panel has no such path and
// relied entirely on this classifier.
for (const refusal of [
  { code: 4200, name: 'UnsupportedProviderMethodError', message: 'wallet does not support wallet_sendCalls' },
  { code: -32601, name: 'MethodNotFoundRpcError', message: 'the method does not exist' },
  { code: -32004, name: 'MethodNotSupportedRpcError', message: 'method not supported' },
]) {
  assert.equal(
    isDefinitivePendingEvmPreSubmissionError(Object.assign(new Error(refusal.message), refusal)),
    true,
    `a refused method must release the reservation: ${refusal.code}`,
  );
}
// ...but a refusal code arriving alongside transport ambiguity still locks.
assert.equal(
  isDefinitivePendingEvmPreSubmissionError(
    Object.assign(new Error('wallet_sendCalls request timed out'), { code: 4200, name: 'TimeoutError' }),
  ),
  false,
);

// The browser talks to a proxy that performs its own ranked failover, so its
// read timeout has to outlast that cascade instead of racing it.
assert.match(
  baseRpcSource,
  /read: \{ fallbackRetryCount: 0, timeoutMs: 12_000 \}/,
  'browser reads must allow for the proxy-side failover they sit in front of',
);

const appEvents = projectFile('lib/app-events.ts');
assert.match(appEvents, /export function openTasksDialog\(\) \{\s*dispatchTypedEvent\(TASKS_OPEN_EVENT\);\s*\}/);
assert.match(appEvents, /export function openStakingDialog\(\) \{\s*dispatchTypedEvent\(STAKING_OPEN_EVENT\);\s*\}/);
assert.match(appEvents, /\[TASKS_OPEN_EVENT, LEGACY_TASKS_OPEN_EVENT\]/);
assert.match(appEvents, /\[STAKING_OPEN_EVENT, LEGACY_STAKING_OPEN_EVENT\]/);

const transferDialog = projectFile('components/transactions/transfer-assets-dialog.tsx');
assert.match(transferDialog, /TRANSFER_PLAN_STORAGE_PREFIX = "pixotchi:transfer-assets:v1"/);
assert.match(transferDialog, /phase: "ready" \| "submission-started"/);
assert.match(transferDialog, /writeTransferPlan\(startedPlan, plan\)/);
assert.match(transferDialog, /intentKey=\{activeStepIntentKey\}/);
assert.match(transferDialog, /key=\{`\$\{activePlan\.planId\}:\$\{activePlan\.nextStepIndex\}`\}/);
assert.match(transferDialog, /status\.statusName !== "success" && status\.statusName !== "reverted"/);
assert.match(transferDialog, /eventId: proof \? `transfer-assets:\$\{proof\.toLowerCase\(\)\}`/);
assert.match(transferDialog, /Fallback mode sends one NFT per confirmed transaction/);
assert.match(transferDialog, /It will not be resent automatically/);
assert.match(transferDialog, /Promise\.allSettled\(\[/);
assert.match(transferDialog, /Retry asset loading/);
assert.match(transferDialog, /Retry approval check/);
assert.match(transferDialog, /!fetchingCounts && !assetLoadError && !hasAnythingToTransfer/);
assert.equal(
  (transferDialog.match(/Approval status unavailable — retry check/g) || []).length,
  2,
);
assert.match(transferDialog, /!approvalStatusLoaded\.plants \|\| !plantApprovalCall/);
assert.match(transferDialog, /!approvalStatusLoaded\.lands \|\| !landApprovalCall/);
assert.match(transferDialog, /plants: plantsApproval\.status === "fulfilled"/);
assert.match(transferDialog, /lands: landsApproval\.status === "fulfilled"/);
assert.doesNotMatch(transferDialog, /\.sendTransaction\(/);
assert.doesNotMatch(transferDialog, /waitForBaseReceipt/);
assert.doesNotMatch(transferDialog, /Promise\.all\(\[\s*plantIds\.length/);

const contractsSource = projectFile('lib/contracts.ts');
const assetTransferHelpers = contractsSource.slice(
  contractsSource.indexOf('// -------------------- ASSET TRANSFERS --------------------'),
  contractsSource.indexOf('// Token balance (returns raw bigint for precision)'),
);
const routerTransferHelper = contractsSource.slice(
  contractsSource.indexOf('// -------------------- ROUTER-BASED BULK TRANSFER --------------------'),
  contractsSource.indexOf('// -------------------- KILL COOLDOWN HELPERS --------------------'),
);
assert.match(assetTransferHelpers, /createNftOperatorApprovalCall/);
assert.match(assetTransferHelpers, /createPlantTransferCall/);
assert.match(assetTransferHelpers, /createLandTransferCall/);
assert.match(routerTransferHelper, /createRouterBatchTransferCall/);
assert.doesNotMatch(assetTransferHelpers, /\.sendTransaction\(/);
assert.doesNotMatch(routerTransferHelper, /\.sendTransaction\(/);
assert.doesNotMatch(assetTransferHelpers, /waitForBaseTransactionSuccess/);
assert.doesNotMatch(routerTransferHelper, /waitForBaseTransactionSuccess/);
assert.doesNotMatch(contractsSource, /export const casinoBuild = async/);
assert.doesNotMatch(contractsSource, /export const casinoPlaceBets = async/);
assert.doesNotMatch(contractsSource, /export const casinoPlaceBetsWithToken = async/);
assert.doesNotMatch(contractsSource, /export const casinoReveal = async/);
assert.doesNotMatch(contractsSource, /walletClient\.writeContract/);

const transferOwner = '0x000000000000000000000000000000000000a001';
const transferTarget = '0x000000000000000000000000000000000000a002';
const transferCollection = '0x000000000000000000000000000000000000a003';
const transferRouter = '0x000000000000000000000000000000000000a004';
const approvalCall = createNftOperatorApprovalCall(transferCollection, transferRouter);
assert.deepEqual(
  approvalCall,
  createNftOperatorApprovalCall(transferCollection, transferRouter),
);
assert.equal(approvalCall.to.toLowerCase(), transferCollection);
const plantTransferCall = createPlantTransferCall(transferOwner, transferTarget, 7);
assert.deepEqual(
  plantTransferCall,
  createPlantTransferCall(transferOwner, transferTarget, 7),
);
assert.notEqual(
  plantTransferCall.data,
  createPlantTransferCall(transferOwner, transferTarget, 8).data,
);
const landTransferCall = createLandTransferCall(transferOwner, transferTarget, BigInt(9));
assert.deepEqual(
  landTransferCall,
  createLandTransferCall(transferOwner, transferTarget, BigInt(9)),
);
assert.notEqual(
  landTransferCall.data,
  createLandTransferCall(transferOwner, transferTarget, BigInt(10)).data,
);
const routerTransferCall = createRouterBatchTransferCall(
  transferTarget,
  [7, 8],
  [BigInt(9), BigInt(10)],
  transferRouter,
);
assert.deepEqual(
  routerTransferCall,
  createRouterBatchTransferCall(
    transferTarget,
    [7, 8],
    [BigInt(9), BigInt(10)],
    transferRouter,
  ),
);
assert.equal(routerTransferCall.to.toLowerCase(), transferRouter);
assert.notEqual(
  routerTransferCall.data,
  createRouterBatchTransferCall(transferTarget, [7, 8], [BigInt(9)], transferRouter).data,
);

const transactionKit = projectFile('components/transactions/transaction-kit.tsx');
assert.match(transactionKit, /statusName: "transactionUnresolved"/);
assert.match(transactionKit, /hasSubmittedProof && !isDefinitivePostSubmissionError\(error\)/);
assert.match(transactionKit, /pendingReceipt = requestCanonicalReceipt\(\)/);
assert.match(transactionKit, /pendingStatus = requestCallsStatus\(\)/);
assert.match(transactionKit, /if \(isSuccessful \|\| isCheckOnly\)/);
assert.match(transactionKit, /return "Check transaction"/);
assert.equal((transactionKit.match(/\.sendCalls\(\{/g) || []).length, 1);
assert.equal((transactionKit.match(/\.sendTransaction\(\{/g) || []).length, 1);
assert.match(transactionKit, /registerPendingEvmController/);
assert.match(transactionKit, /createSubmissionReservation/);
assert.match(transactionKit, /finalizePendingEvmRecord/);
assert.match(transactionKit, /promotePendingEvmCoordinatorAttemptToMonitor/);
assert.match(transactionKit, /setIsPeerBlocked\(true\)/);
assert.match(transactionKit, /withPendingEvmMonitorLease/);
assert.match(transactionKit, /isDefinitivePendingEvmPreSubmissionError/);
assert.match(transactionKit, /isDefinitiveUnsupportedEvmBatchError/);
assert.doesNotMatch(transactionKit, /firstReceiptLogs/);
assert.match(
  transactionKit,
  /result\?\.status === "success"[\s\S]*if \(!nextTransactionHash\)[\s\S]*waitForCanonicalReceipt/,
);
assert.match(transactionKit, /Wallet reported success without a transaction hash; waiting for canonical Base receipt evidence/);
assert.match(transactionKit, /I checked my wallet — allow another transaction/);
assert.match(transactionKit, /size="touchCompact"/);
assert.doesNotMatch(transactionKit, /subscribePendingEvmChanges/);
const unsupportedFallbackSource = transactionKit.slice(
  transactionKit.indexOf('const unsupportedReservation = coordinatedPendingRecord'),
  transactionKit.indexOf('await executeDirectTransactions();'),
);
assert.match(unsupportedFallbackSource, /removePendingEvmRecord/);
assert.match(unsupportedFallbackSource, /releasePendingEvmCoordinatorAttempt/);
const pendingCoordinator = projectFile('lib/pending-evm-coordinator.ts');
assert.match(pendingCoordinator, /const coordinators = new Map/);
assert.match(pendingCoordinator, /record\.proof\.kind !== "reservation"/);
assert.match(pendingCoordinator, /abortController\.abort\(\)/);
assert.match(pendingCoordinator, /feedbackRecord: registration\.controllerId === feedbackOwner/);
const terminalStatuses = transactionKit.match(/const TERMINAL_STATUSES[\s\S]*?\]\);/)?.[0] ?? '';
assert.doesNotMatch(terminalStatuses, /transactionUnresolved/);
assert.doesNotMatch(terminalStatuses, /transactionStale/);

const pendingStorage = new MemoryStorage();
const pendingAccount = '0x000000000000000000000000000000000000c0de';
const pendingIdentity = {
  accountAddress: pendingAccount,
  chainId: 8453,
  intentKey: 'smoke:stable-intent',
};
const pendingCallsDigest = createPendingEvmCallsDigest([{
  to: '0x000000000000000000000000000000000000beef',
  data: '0x1234',
  value: BigInt(7),
}]);
const changedCallsDigest = createPendingEvmCallsDigest([{
  to: '0x000000000000000000000000000000000000beef',
  data: '0x5678',
  value: BigInt(7),
}]);
assert.equal(
  isDefinitivePendingEvmPreSubmissionError(
    Object.assign(new Error('wallet request failed'), {
      cause: Object.assign(new Error('insufficient funds for gas'), {
        name: 'InsufficientFundsError',
      }),
    }),
  ),
  true,
);
assert.equal(
  isDefinitivePendingEvmPreSubmissionError(new Error('network timeout after wallet request')),
  false,
);
assert.equal(
  isDefinitivePendingEvmPreSubmissionError(
    new Error('request rejected after wallet broadcast response was lost'),
  ),
  false,
);
assert.equal(
  isDefinitiveUnsupportedEvmBatchError({
    name: 'TransactionExecutionError',
    message: 'wallet_sendCalls failed',
    cause: { code: -32601, name: 'MethodNotFoundRpcError' },
  }),
  true,
);
assert.equal(
  isDefinitiveUnsupportedEvmBatchError(
    new Error('wallet_sendCalls request timed out after forwarding'),
  ),
  false,
);
// A wallet that refuses wallet_sendCalls with a bare, uncoded Error must still
// fall back to a direct transaction. Treating that refusal as "might have been
// broadcast" kept the batch reservation, which locked every transaction button
// while nothing had ever reached a node — production claims simply stopped with
// "Wallet confirmation may still be pending".
for (const refusal of [
  'Local test wallet does not support wallet_sendCalls.',
  'wallet_sendCalls is unsupported by this wallet',
  'wallet_sendCalls is not supported by this wallet',
]) {
  assert.equal(
    isDefinitiveUnsupportedEvmBatchError(new Error(refusal)),
    true,
    `an explicit refusal must release the batch reservation: ${refusal}`,
  );
}
// ...but only when the message names the batch method and carries no transport
// ambiguity. These must all stay locked.
for (const ambiguous of [
  'wallet_sendCalls failed: network connection lost',
  'eth_signTypedData_v4 is unsupported',
  'something went wrong',
]) {
  assert.equal(
    isDefinitiveUnsupportedEvmBatchError(new Error(ambiguous)),
    false,
    `must not release a batch reservation on: ${ambiguous}`,
  );
}
// The local test connector must report unsupported methods with an EIP-1193
// code, the way a real wallet does, rather than a bare Error.
const localTestConnectorSource = projectFile('lib/local-test-connector.ts');
assert.match(localTestConnectorSource, /class LocalTestUnsupportedMethodError extends Error \{\s*code = 4200;/);
assert.match(localTestConnectorSource, /throw new LocalTestUnsupportedMethodError\("wallet_sendCalls"\)/);
assert.doesNotMatch(
  localTestConnectorSource,
  /throw new Error\(`?"?Local test wallet does not support/,
  'unsupported-method refusals must carry a provider error code',
);
const directHash = `0x${'11'.repeat(32)}` as Hex;
const directRecord = createPendingEvmRecord({
  attemptId: 'attempt-direct-1',
  callsDigest: pendingCallsDigest,
  identity: pendingIdentity,
  method: 'direct',
  proof: { kind: 'hash', hash: directHash },
  submittedAt: Date.now(),
});
assert.equal(writePendingEvmRecord(pendingStorage, directRecord), true);
assert.equal(readPendingEvmRecord(pendingStorage, pendingIdentity)?.attemptId, 'attempt-direct-1');
assert.equal(canDurablyPersistPendingEvmTransactions(pendingStorage), true);
assert.notEqual(
  getPendingEvmStorageKey(pendingIdentity),
  getPendingEvmStorageKey({ ...pendingIdentity, intentKey: 'smoke:other-intent' }),
);
assert.notEqual(
  getPendingEvmStorageKey(pendingIdentity),
  getPendingEvmStorageKey({ ...pendingIdentity, chainId: 1 }),
);
// Stable intent is authoritative for status-only recovery: volatile deadline,
// nonce, or signature calldata may legitimately change after reload.
assert.deepEqual(
  getPendingEvmCompatibility(directRecord, {
    callsDigest: changedCallsDigest,
    connectorId: 'different-wallet',
  }),
  { callsMatch: false, connectorMatch: true, canResume: true },
);

// Compare-and-delete must not let an old monitor remove a newer same-intent attempt.
const newerRecord = createPendingEvmRecord({
  attemptId: 'attempt-direct-2',
  callsDigest: changedCallsDigest,
  identity: pendingIdentity,
  method: 'direct',
  proof: { kind: 'hash', hash: `0x${'22'.repeat(32)}` as Hex },
});
writePendingEvmRecord(pendingStorage, newerRecord);
assert.equal(removePendingEvmRecord(pendingStorage, directRecord), true);
assert.equal(readPendingEvmRecord(pendingStorage, pendingIdentity)?.attemptId, 'attempt-direct-2');

// Physical attempt records are immutable: the same attempt id cannot be
// overwritten with a different proof, while other attempts remain isolated.
const conflictingSameAttempt = createPendingEvmRecord({
  attemptId: newerRecord.attemptId,
  callsDigest: pendingCallsDigest,
  identity: pendingIdentity,
  method: 'direct',
  proof: { kind: 'hash', hash: `0x${'33'.repeat(32)}` as Hex },
  submittedAt: newerRecord.submittedAt,
});
assert.equal(writePendingEvmRecord(pendingStorage, conflictingSameAttempt), false);
assert.equal(readPendingEvmRecord(pendingStorage, pendingIdentity)?.proof.kind, 'hash');

// A remote/localStorage deletion is authoritative and cannot be resurrected
// from this tab's memory mirror.
const mirrorIdentity = { ...pendingIdentity, intentKey: 'smoke:mirror-removal' };
const mirrorRecord = createPendingEvmRecord({
  attemptId: 'attempt-mirror-1',
  callsDigest: pendingCallsDigest,
  identity: mirrorIdentity,
  method: 'direct',
  proof: { kind: 'hash', hash: directHash },
});
writePendingEvmRecord(pendingStorage, mirrorRecord);
assert.equal(readPendingEvmRecord(pendingStorage, mirrorIdentity)?.attemptId, mirrorRecord.attemptId);
for (let index = 0; index < pendingStorage.length; index += 1) {
  const key = pendingStorage.key(index);
  if (key?.includes(mirrorRecord.intentDigest)) pendingStorage.removeItem(key);
}
assert.equal(readPendingEvmRecord(pendingStorage, mirrorIdentity), null);

// A padded durable reservation exists before the wallet is called and is
// atomically finalized in-place once proof arrives.
const reservationIdentity = { ...pendingIdentity, intentKey: 'smoke:reservation' };
const reservation = createPendingEvmRecord({
  attemptId: 'attempt-reservation-1',
  callsDigest: pendingCallsDigest,
  identity: reservationIdentity,
  method: 'direct',
  proof: { kind: 'reservation' },
  submittedAt: Date.now() - 5_000,
});
assert.ok(JSON.stringify(reservation).length > 3_500);
assert.equal(writePendingEvmRecord(pendingStorage, reservation), true);
const finalizedReservation = finalizePendingEvmRecord(
  pendingStorage,
  reservation,
  { kind: 'hash', hash: directHash },
);
assert.equal(finalizedReservation?.persisted, true);
assert.ok((finalizedReservation?.record.submittedAt ?? 0) > reservation.submittedAt);
assert.equal(readPendingEvmRecord(pendingStorage, reservationIdentity)?.proof.kind, 'hash');

const finalizeFailStorage = new FinalizeFailStorage();
const finalizeFailIdentity = { ...pendingIdentity, intentKey: 'smoke:reservation-finalize-fail' };
const finalizeFailReservation = createPendingEvmRecord({
  attemptId: 'attempt-reservation-fail',
  callsDigest: pendingCallsDigest,
  identity: finalizeFailIdentity,
  method: 'direct',
  proof: { kind: 'reservation' },
  submittedAt: Date.now() - PENDING_EVM_HARD_LOCK_MS + 1_000,
});
writePendingEvmRecord(finalizeFailStorage, finalizeFailReservation);
finalizeFailStorage.failProofWrite = true;
const failedFinalization = finalizePendingEvmRecord(
  finalizeFailStorage,
  finalizeFailReservation,
  { kind: 'hash', hash: directHash },
);
assert.equal(failedFinalization?.persisted, false);
assert.equal(getPendingEvmPhase(failedFinalization!.blocker), 'hard');
assert.equal(
  readPendingEvmRecord(finalizeFailStorage, finalizeFailIdentity)?.submittedAt,
  failedFinalization?.blocker.submittedAt,
);

const staleIdentity = { ...pendingIdentity, intentKey: 'smoke:stale' };
const staleRecord = createPendingEvmRecord({
  attemptId: 'attempt-stale-1',
  callsDigest: pendingCallsDigest,
  identity: staleIdentity,
  method: 'direct',
  proof: { kind: 'hash', hash: directHash },
  submittedAt: Date.now() - PENDING_EVM_HARD_LOCK_MS - 1,
});
writePendingEvmRecord(pendingStorage, staleRecord);
assert.equal(getPendingEvmPhase(staleRecord), 'stale');
assert.equal(acknowledgePendingEvmRecord(pendingStorage, staleRecord), true);
assert.equal(readPendingEvmRecord(pendingStorage, staleIdentity), null);
assert.equal(acknowledgePendingEvmRecord(pendingStorage, newerRecord), false);

// Exercised inside runAsyncPendingTransactionSmoke below: the lease check needs
// an async scope, and this file's transform has no top-level await.
let ambiguousAckFixture: {
  identity: { accountAddress: string; chainId: number; intentKey: string };
  record: ReturnType<typeof createPendingEvmRecord>;
} | null = null;

// --- A stuck proofless reservation must not strand the wallet -----------------
//
// An ambiguous transport failure leaves a reservation with no hash and no calls
// id. That used to inherit the 30-minute submission lock, so any hiccup froze
// every transaction button in the app for half an hour: the UI said "check your
// wallet activity" and then offered no way to act on what the player found.
// A proofless record has nothing to watch and nothing that can resolve it on its
// own, so it unlocks on the short window; anything carrying proof still does not.
{
  const ambiguousIdentity = { ...pendingIdentity, intentKey: 'smoke:ambiguous-ack' };
  const agedReservation = createPendingEvmRecord({
    attemptId: 'attempt-ambiguous-ack',
    callsDigest: pendingCallsDigest,
    identity: ambiguousIdentity,
    method: 'direct',
    proof: { kind: 'reservation' },
    submittedAt: Date.now() - PENDING_EVM_AMBIGUOUS_ACK_LOCK_MS - 1,
  });
  assert.equal(getPendingEvmPhase(agedReservation), 'stale');

  const freshReservation = createPendingEvmRecord({
    attemptId: 'attempt-ambiguous-fresh',
    callsDigest: pendingCallsDigest,
    identity: ambiguousIdentity,
    method: 'direct',
    proof: { kind: 'reservation' },
    submittedAt: Date.now() - 1_000,
  });
  assert.equal(getPendingEvmPhase(freshReservation), 'hard');

  // Proof-bearing records keep the long lock at the same age.
  const provenAtSameAge = createPendingEvmRecord({
    attemptId: 'attempt-proven-same-age',
    callsDigest: pendingCallsDigest,
    identity: { ...pendingIdentity, intentKey: 'smoke:proven-same-age' },
    method: 'direct',
    proof: { kind: 'hash', hash: directHash },
    submittedAt: Date.now() - PENDING_EVM_AMBIGUOUS_ACK_LOCK_MS - 1,
  });
  assert.equal(getPendingEvmPhase(provenAtSameAge), 'hard');
  assert.ok(PENDING_EVM_AMBIGUOUS_ACK_LOCK_MS < PENDING_EVM_HARD_LOCK_MS);

  ambiguousAckFixture = { identity: ambiguousIdentity, record: agedReservation };
}


// A rejection our own proxy made before forwarding anything upstream is proof
// that nothing was broadcast, so it releases the reservation instead of locking
// the wallet. It must outrank the "reads network-ish" ambiguity heuristic.
{
  const proxyRejection = Object.assign(new Error(
    `HTTP request failed.

Status code: 429
URL: http://localhost:3000/api/rpc
Details: Rate limit exceeded [${PENDING_EVM_PROXY_NOT_FORWARDED_MARKER}]`,
  ), { name: 'HttpRequestError', status: 429 });
  assert.equal(isDefinitivePendingEvmPreSubmissionError(proxyRejection), true);

  const batchTooLarge = Object.assign(new Error(
    `HTTP request failed.

Status code: 400
Details: Batch size is limited to 20 [${PENDING_EVM_PROXY_NOT_FORWARDED_MARKER}]`,
  ), { name: 'HttpRequestError', status: 400 });
  assert.equal(isDefinitivePendingEvmPreSubmissionError(batchTooLarge), true);

  // An unmarked transport failure stays ambiguous: it may have been forwarded.
  const upstreamTimeout = Object.assign(new Error('The request took too long to respond.'), {
    name: 'TimeoutError',
  });
  assert.equal(isDefinitivePendingEvmPreSubmissionError(upstreamTimeout), false);
}

assert.match(
  rpcProxySource,
  new RegExp(`const NOT_FORWARDED_MARKER = '${PENDING_EVM_PROXY_NOT_FORWARDED_MARKER}';`),
  'the proxy marker must stay in sync with the client-side classifier',
);
assert.doesNotMatch(
  rpcProxySource,
  /return NextResponse\.json\(rpcError\(null, INVALID_REQUEST, `Batch size/,
  'proxy-side gate rejections must be marked as never forwarded',
);

const batchIdentity = { ...pendingIdentity, intentKey: 'smoke:batch' };
const batchRecord = createPendingEvmRecord({
  attemptId: 'attempt-batch-1',
  callsDigest: pendingCallsDigest,
  connectorId: 'wallet-a',
  identity: batchIdentity,
  method: 'batch',
  proof: { kind: 'calls', id: 'calls-status-id' },
});
assert.equal(
  getPendingEvmCompatibility(batchRecord, {
    callsDigest: pendingCallsDigest,
    connectorId: 'wallet-b',
  }).canResume,
  false,
);

let receiptWaits = 0;
let callsStatusWaits = 0;
let sendTransactionCalls = 0;
let sendCallsCalls = 0;
const recoveryHarness = {
  waitForReceipt: async () => {
    receiptWaits += 1;
    return { status: 'success' };
  },
  waitForCallsStatus: async () => {
    callsStatusWaits += 1;
    return { status: 'success' };
  },
  sendTransaction: () => { sendTransactionCalls += 1; },
  sendCalls: () => { sendCallsCalls += 1; },
};
void resumePendingEvmRecord(directRecord, recoveryHarness);
void resumePendingEvmRecord(batchRecord, recoveryHarness);
assert.equal(receiptWaits, 1);
assert.equal(callsStatusWaits, 1);
assert.equal(sendTransactionCalls, 0);
assert.equal(sendCallsCalls, 0);

for (const [suffix, rawValue] of [
  ['malformed', '{'],
  ['oversized', 'x'.repeat(PENDING_EVM_MAX_RECORD_SIZE + 1)],
] as const) {
  const identity = { ...pendingIdentity, intentKey: `smoke:${suffix}` };
  pendingStorage.setItem(getPendingEvmStorageKey(identity), rawValue);
  assert.equal(readPendingEvmRecord(pendingStorage, identity), null);
  assert.equal(pendingStorage.getItem(getPendingEvmStorageKey(identity)), null);
}

const legacyIdentity = { ...pendingIdentity, intentKey: 'smoke:legacy-v2-key' };
const legacyRecord = createPendingEvmRecord({
  attemptId: 'attempt-legacy-1',
  callsDigest: pendingCallsDigest,
  identity: legacyIdentity,
  method: 'direct',
  proof: { kind: 'hash', hash: directHash },
});
pendingStorage.setItem(getPendingEvmStorageKey(legacyIdentity), JSON.stringify(legacyRecord));
assert.equal(readPendingEvmRecord(pendingStorage, legacyIdentity)?.attemptId, legacyRecord.attemptId);
assert.equal(removePendingEvmRecord(pendingStorage, legacyRecord), true);
assert.equal(readPendingEvmRecord(pendingStorage, legacyIdentity), null);

for (const [suffix, submittedAt] of [
  ['future', Date.now() + 6 * 60 * 1_000],
  ['expired', Date.now() - PREVIOUS_PENDING_EVM_AUTO_PRUNE_MS - 1],
] as const) {
  const identity = { ...pendingIdentity, intentKey: `smoke:${suffix}` };
  const invalidTimeRecord = createPendingEvmRecord({
    attemptId: `attempt-${suffix}`,
    callsDigest: pendingCallsDigest,
    identity,
    method: 'direct',
    proof: { kind: 'hash', hash: directHash },
    submittedAt,
  });
  writePendingEvmRecord(pendingStorage, invalidTimeRecord);
  const storedTimeRecord = readPendingEvmRecord(pendingStorage, identity);
  // Proven transactions survive both long elapsed time and a backwards local
  // clock correction. Both become explicit-ack stale; neither auto-unlocks a
  // duplicate wallet submission.
  assert.equal(storedTimeRecord?.attemptId, invalidTimeRecord.attemptId);
  assert.equal(getPendingEvmPhase(invalidTimeRecord), 'stale');
  assert.equal(acknowledgePendingEvmRecord(pendingStorage, invalidTimeRecord), true);
}

const throwingStorage: PendingEvmStorage = {
  getItem: () => { throw new Error('storage disabled'); },
  removeItem: () => { throw new Error('storage disabled'); },
  setItem: () => { throw new Error('storage disabled'); },
};
const fallbackIdentity = { ...pendingIdentity, intentKey: 'smoke:memory-fallback' };
const fallbackRecord = createPendingEvmRecord({
  attemptId: 'attempt-memory-1',
  callsDigest: pendingCallsDigest,
  identity: fallbackIdentity,
  method: 'direct',
  proof: { kind: 'hash', hash: directHash },
});
assert.equal(writePendingEvmRecord(throwingStorage, fallbackRecord), false);
assert.equal(readPendingEvmRecord(throwingStorage, fallbackIdentity)?.attemptId, 'attempt-memory-1');
assert.equal(canDurablyPersistPendingEvmTransactions(throwingStorage), false);

const unenumerableValues = new Map<string, string>();
const unenumerableStorage: PendingEvmStorage = {
  getItem: (key) => unenumerableValues.get(key) ?? null,
  removeItem: (key) => { unenumerableValues.delete(key); },
  setItem: (key, value) => { unenumerableValues.set(key, value); },
};
assert.equal(canDurablyPersistPendingEvmTransactions(unenumerableStorage), false);

const removalFailStorage = new RemovalFailStorage();
const removalFailIdentity = { ...pendingIdentity, intentKey: 'smoke:remove-failure' };
const removalFailRecord = createPendingEvmRecord({
  attemptId: 'attempt-remove-failure',
  callsDigest: pendingCallsDigest,
  identity: removalFailIdentity,
  method: 'direct',
  proof: { kind: 'hash', hash: directHash },
});
writePendingEvmRecord(removalFailStorage, removalFailRecord);
removalFailStorage.failRemoval = true;
assert.equal(removePendingEvmRecord(removalFailStorage, removalFailRecord), false);
assert.equal(readPendingEvmRecord(removalFailStorage, removalFailIdentity)?.attemptId, removalFailRecord.attemptId);

// Distinct receipt-less reconciliations are coalesced for only 250ms. Their
// generated event ids must remain distinct through the BalanceProvider event
// boundary instead of becoming one 15-second `balances:unkeyed` dedupe key.
const fakeWindow = new class extends EventTarget {
  setTimeout = globalThis.setTimeout.bind(globalThis);
  clearTimeout = globalThis.clearTimeout.bind(globalThis);
}();
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: fakeWindow,
});
const unkeyedRefreshIds: string[] = [];
const stopUnkeyedRefreshListener = onBalanceRefresh((detail) => {
  unkeyedRefreshIds.push(detail.eventId);
});
const realDateNow = Date.now;
let fakeNow = 1_000_000;
Date.now = () => fakeNow;
dispatchPostTransactionRefresh(undefined, [0], { source: 'unkeyed-smoke' });
fakeNow += 275;
dispatchPostTransactionRefresh(undefined, [0], { source: 'unkeyed-smoke' });
Date.now = realDateNow;
stopUnkeyedRefreshListener();
assert.equal(unkeyedRefreshIds.length, 2);
assert.notEqual(unkeyedRefreshIds[0], unkeyedRefreshIds[1]);
assert.doesNotMatch(
  projectFile('lib/transaction-refresh.ts'),
  /dedupeKey: getRefreshKey\("balances", context\)/,
);
delete (globalThis as { window?: unknown }).window;

// The About tab's docs link was removed in 436d689 and pinned out with a pair
// of doesNotMatch assertions. It was reinstated on request as a fourth action
// button, so the pin now asserts the intended shape instead of its absence.
const aboutTab = projectFile('components/tabs/about-tab.tsx');
assert.match(aboutTab, /openExternalUrl\('https:\/\/doc\.pixotchi\.tech'\)/);
assert.match(aboutTab, /aria-label="Open Pixotchi documentation"/);
// The mobile action grid is two columns, so only an odd number of buttons may
// take a full-width final row. With the tutorial button that is four, without
// it three — the span therefore belongs to the last button, not to Status.
assert.match(
  aboutTab,
  /className=\{enabled \? "tablet:w-auto" : "col-span-2 tablet:col-span-1 tablet:w-auto"\}/,
);
assert.doesNotMatch(
  aboutTab,
  /onClick=\{\(\) => openExternalUrl\('https:\/\/status\.pixotchi\.tech'\)\}\s*\n\s*className=\{enabled \? "col-span-2/,
  'Status must no longer carry the odd-count row span',
);

const appPage = projectFile('app/(game)/page.tsx');
assert.match(appPage, /function SharedFarmMintMobileToggle/);
assert.match(appPage, /data-shared-farm-mint-toggle/);
assert.match(appPage, /setMintType\(nextValue === 'lands' \? 'land' : 'plant'\)/);

const providers = projectFile('app/providers.tsx');
const wagmiRouterSource = providers.slice(
  providers.indexOf('function WagmiRouter('),
  providers.indexOf('export function Providers'),
);
const fallbackGateIndex = wagmiRouterSource.indexOf(
  "if (loadedConfig?.key !== desiredConfigKey) return",
);
const coreProviderIndex = wagmiRouterSource.indexOf('<CoreWagmiProvider');
const miniAppReadyIndex = wagmiRouterSource.indexOf('<MiniAppReadySignal');
assert.ok(fallbackGateIndex >= 0);
assert.ok(coreProviderIndex > fallbackGateIndex);
assert.ok(miniAppReadyIndex > coreProviderIndex);
assert.match(
  wagmiRouterSource,
  /\{isMiniApp \? <MiniAppReadySignal hostEnvironment=\{hostEnvironmentState\} \/> : null\}/,
);
const providersContentSource = providers.slice(providers.indexOf('function ProvidersContent('));
assert.doesNotMatch(providersContentSource, /useMiniAppReadySignal\(/);

const webQueryState = projectFile('hooks/useWebQueryState.ts');
assert.match(webQueryState, /pixotchi:web-query-state/);
assert.match(webQueryState, /window\.dispatchEvent\(new Event\(WEB_QUERY_STATE_EVENT\)\)/);

const dashboardTab = projectFile('components/tabs/dashboard-tab.tsx');
assert.match(dashboardTab, /hidden justify-center tablet:flex/);

const mintTab = projectFile('components/tabs/mint-tab.tsx');
assert.match(mintTab, /ApprovalActionTransaction/);
assert.match(mintTab, /batchButtonText="Approve \+ Mint"/);
assert.match(mintTab, /batchButtonText="Approve \+ Mint Land"/);
assert.doesNotMatch(mintTab, /Step 1/);
assert.doesNotMatch(mintTab, /Step 2/);
assert.doesNotMatch(mintTab, /isSmartWallet && isSponsored \?/);
const typesSource = projectFile('lib/types.ts');
assert.match(typesSource, /mintPriceRaw: bigint/);
assert.match(contractsSource, /mintPriceRaw: BigInt\(strain\.mintPrice\)/);
assert.match(mintTab, /selectedStrain\.paymentPrice \?\? selectedStrain\.mintPriceRaw/);
assert.doesNotMatch(mintTab, /BigInt\(Math\.floor\(\(selectedStrain\.mintPrice/);
assert.doesNotMatch(mintTab, /setPaymentTokenBalance\(BigInt\(Math\.floor/);
// Payment-token reads publish one identity-stamped snapshot; stale account,
// strain, and token generations cannot unlock the mint gate.
assert.match(mintTab, /paymentTokenRequestGenerationRef = useRef\(0\)/);
assert.match(mintTab, /paymentTokenSnapshot\.identity === paymentTokenIdentity/);
assert.match(mintTab, /paymentTokenRequestGenerationRef\.current !== requestGeneration/);
assert.match(mintTab, /identity: paymentTokenIdentity/);
// Main plant/land loading has independent latest-only ownership, including its
// success, error, and loading-finalizer paths.
assert.match(mintTab, /currentMintFetchKeyRef = useRef<string \| null>\(mintFetchKey\)/);
assert.match(mintTab, /mintFetchGenerationRef\.current === requestGeneration/);
assert.match(mintTab, /if \(!isCurrentRequest\(\)\) return;\s*setLandBalance\(lands\);/);
assert.match(mintTab, /setLandMintDataIdentity\(fetchKey\)/);
assert.match(mintTab, /finally \{\s*if \(isCurrentRequest\(\)\) setLoading\(false\);/);
assert.doesNotMatch(mintTab, /checkLandMintApproval\(address\)\.then\(setLandMintAllowance\)/);

const approvalActionTransaction = projectFile('components/transactions/approval-action-transaction.tsx');
assert.match(approvalActionTransaction, /SmartWalletTransaction[\s\S]*calls=\{\[approvalCall, \.\.\.actionCalls\]\}/);
assert.match(approvalActionTransaction, /SponsoredTransaction[\s\S]*calls=\{\[approvalCall\]\}/);
assert.match(approvalActionTransaction, /feedbackMode = 'toast'/);

const itemDetailsPanel = projectFile('components/item-details-panel.tsx');
assert.match(itemDetailsPanel, /ApprovalActionTransaction/);
assert.match(itemDetailsPanel, /getBuyShopItemCall/);
assert.match(itemDetailsPanel, /getBuyGardenItemCall/);
assert.match(itemDetailsPanel, /batchButtonText=\{approvalActionButtonText\}/);
assert.doesNotMatch(itemDetailsPanel, /ApproveTransaction/);

const envConfig = projectFile('lib/env-config.ts');
assert.match(envConfig, /SWAP_QUOTE_SUMMARY_ENABLED: process\.env\.NEXT_PUBLIC_SWAP_QUOTE_SUMMARY_ENABLED === 'true'/);

const envExample = projectFile('.env.example');
assert.match(envExample, /NEXT_PUBLIC_SWAP_QUOTE_SUMMARY_ENABLED=false/);

const swapPanelQuoteFlag = projectFile('components/tabs/pixotchi-swap-panel.tsx');
assert.match(swapPanelQuoteFlag, /const showQuoteSummary = CLIENT_ENV\.SWAP_QUOTE_SUMMARY_ENABLED/);
assert.match(swapPanelQuoteFlag, /\{showQuoteSummary && quoteSummary && \(/);

const blackjackDialog = projectFile('components/transactions/BlackjackDialog.tsx');
assert.match(blackjackDialog, /mobileMode="center"/);
assert.doesNotMatch(blackjackDialog, /mobileMode="sheet"/);
assert.match(blackjackDialog, /hideCloseButton/);
assert.match(blackjackDialog, /<DialogTitle className="sr-only">Blackjack<\/DialogTitle>/);
assert.match(blackjackDialog, /Close Blackjack dialog/);
assert.doesNotMatch(blackjackDialog, /<DialogHeader/);
assert.match(blackjackDialog, /BLACKJACK_STICKY_ACTIONS_CLASS/);
assert.match(blackjackDialog, /data-blackjack-action-footer/);
assert.match(blackjackDialog, /dialog-footer-surface sticky/);
assert.match(blackjackDialog, /bg-\[linear-gradient\(180deg,rgb\(0,0,0\)_0%,rgb\(0,0,0\)_42%,rgb\(0,0,0\)_100%\)\]/);
assert.doesNotMatch(blackjackDialog, /BLACKJACK_STICKY_ACTIONS_CLASS = .*bg-black\/75/);

const casinoDialog = projectFile('components/transactions/CasinoDialog.tsx');
assert.match(casinoDialog, /mobileMode="center"/);
assert.doesNotMatch(casinoDialog, /mobileMode="sheet"/);
assert.match(casinoDialog, /hideCloseButton/);
assert.match(casinoDialog, /<DialogTitle className="sr-only">Roulette<\/DialogTitle>/);
assert.match(casinoDialog, /Close Roulette dialog/);
assert.doesNotMatch(casinoDialog, /<DialogHeader/);
assert.match(casinoDialog, /showRoundResult = !!result && !isSpinning && !wheelSpinning/);
assert.match(casinoDialog, /No win this spin/);
assert.doesNotMatch(casinoDialog, /<span className="font-bold">No win<\/span>/);
assert.match(casinoDialog, /bg-\[linear-gradient\(180deg,rgb\(0,0,0\)_0%,rgb\(0,0,0\)_42%,rgb\(0,0,0\)_100%\)\]/);
assert.doesNotMatch(casinoDialog, /<DialogFooter sticky className="[^"]*bg-black\/75/);

for (const transactionWrapper of [
  'components/transactions/sponsored-transaction.tsx',
  'components/transactions/universal-transaction.tsx',
]) {
  const source = projectFile(transactionWrapper);
  assert.match(source, /feedbackMode \?\? "toast"/);
  assert.match(source, /const showGlobalToast = showToast/);
  assert.doesNotMatch(source, /feedbackMode \?\? \(showToast \? "both"/);
  assert.doesNotMatch(source, /feedbackMode \?\? \(showToast \? "toast" : "inline"\)/);
}

const smartWalletTransaction = projectFile('components/transactions/smart-wallet-transaction.tsx');
assert.match(smartWalletTransaction, /<UniversalTransaction \{\.\.\.props\} \/>/);

const blackjackTransaction = projectFile('components/transactions/blackjack-transaction.tsx');
assert.match(blackjackTransaction, /<GlobalTransactionToast \/>/);
assert.doesNotMatch(blackjackTransaction, /<TransactionStatus \/>/);

const claimRewardsTransaction = projectFile('components/transactions/claim-rewards-transaction.tsx');
assert.match(claimRewardsTransaction, /<UniversalTransaction/);
assert.match(claimRewardsTransaction, /forceUnsponsored/);

const plantNameTransaction = projectFile('components/transactions/plant-name-transaction.tsx');
assert.match(plantNameTransaction, /<SponsoredTransaction/);

const swapPanel = projectFile('components/tabs/pixotchi-swap-panel.tsx');
assert.match(swapPanel, /hasInsufficientGas/);
assert.match(swapPanel, /S\.errors\.insufficientGas/);
assert.match(swapPanel, /withPendingEvmSubmissionGuard/);
assert.match(swapPanel, /finalizePendingEvmRecord/);
assert.match(swapPanel, /withPendingEvmMonitorLease/);
assert.match(swapPanel, /SWAP_APPROVAL_INTENT_KEY/);
assert.match(swapPanel, /SWAP_EXECUTION_INTENT_KEY/);

const aiContext = projectFile('lib/ai-context.ts');
assert.match(aiContext, /plant statusLabel/);
assert.match(aiContext, /Do not paraphrase it into a different health word/);

async function runAsyncPendingTransactionSmoke() {
  const receiptHash = `0x${'44'.repeat(32)}` as Hex;
  const zeroBlockHash = `0x${'00'.repeat(32)}` as Hex;
  const canonicalBlockHash = `0x${'55'.repeat(32)}` as Hex;
  const receiptFixture = (
    blockHash: Hex,
    status: TransactionReceipt['status'] = 'success',
  ) => ({
    blockHash,
    status,
    transactionHash: receiptHash,
  }) as TransactionReceipt;

  // Base preconfirmations use an all-zero block hash. They must not resolve
  // the shared receipt wait or trigger stale state reads; transient receipt
  // misses remain retryable and no transaction can be broadcast again here.
  let receiptNow = 10_000;
  let initialReceiptWaits = 0;
  let canonicalReceiptPolls = 0;
  let duplicateReceiptTestSends = 0;
  const receiptResponses: Array<TransactionReceipt | Error> = [
    new Error('temporary network timeout'),
    receiptFixture(zeroBlockHash),
    receiptFixture(canonicalBlockHash),
  ];
  const canonicalReceiptClient = {
    getTransactionReceipt: async () => {
      canonicalReceiptPolls += 1;
      const response = receiptResponses.shift();
      if (response instanceof Error) throw response;
      assert.ok(response);
      return response;
    },
    sendTransaction: () => { duplicateReceiptTestSends += 1; },
    waitForTransactionReceipt: async () => {
      initialReceiptWaits += 1;
      return receiptFixture(zeroBlockHash);
    },
  };
  const canonicalReceipt = await waitForCanonicalBaseReceipt(
    canonicalReceiptClient,
    receiptHash,
    {
      now: () => receiptNow,
      pollingIntervalMs: 100,
      timeoutMs: 1_000,
      wait: async (ms) => { receiptNow += ms; },
    },
  );
  assert.equal(canonicalReceipt.blockHash, canonicalBlockHash);
  assert.equal(canonicalReceipt.status, 'success');
  assert.equal(initialReceiptWaits, 1);
  assert.equal(canonicalReceiptPolls, 3);
  assert.equal(duplicateReceiptTestSends, 0);

  // The canonical receipt is authoritative for success/revert state; never
  // preserve a provisional success if the canonical receipt reverted.
  const revertedReceipt = await waitForCanonicalBaseReceipt(
    {
      getTransactionReceipt: async () =>
        receiptFixture(canonicalBlockHash, 'reverted'),
      waitForTransactionReceipt: async () => receiptFixture(zeroBlockHash),
    },
    receiptHash,
    {
      now: () => receiptNow,
      pollingIntervalMs: 1,
      timeoutMs: 10,
      wait: async (ms) => { receiptNow += ms; },
    },
  );
  assert.equal(revertedReceipt.status, 'reverted');

  // An RPC that never progresses past preconfirmation remains bounded by the
  // same overall deadline, including the initial Viem receipt wait.
  let timeoutNow = 0;
  let timeoutPolls = 0;
  await assert.rejects(
    waitForCanonicalBaseReceipt(
      {
        getTransactionReceipt: async () => {
          timeoutPolls += 1;
          return receiptFixture(zeroBlockHash);
        },
        waitForTransactionReceipt: async () => receiptFixture(zeroBlockHash),
      },
      receiptHash,
      {
        now: () => timeoutNow,
        pollingIntervalMs: 100,
        timeoutMs: 250,
        wait: async (ms) => { timeoutNow += ms; },
      },
    ),
    /timed out/i,
  );
  assert.equal(timeoutNow, 250);
  assert.equal(timeoutPolls, 2);

  const submitTrackedSwapFixture = async ({
    identity,
    onSend,
    storage,
  }: {
    identity: { accountAddress: string; chainId: number; intentKey: string };
    onSend: () => Promise<Hex>;
    storage: MemoryStorage;
  }) => {
    const registry = {
      accountAddress: identity.accountAddress,
      chainId: identity.chainId,
    };
    const guarded = await withPendingEvmSubmissionGuard(storage, registry, async () => {
      const reservation = createPendingEvmRecord({
        callsDigest: pendingCallsDigest,
        identity,
        method: 'direct',
        proof: { kind: 'reservation' },
      });
      assert.equal(writePendingEvmRecord(storage, reservation), true);
      assert.equal(
        readPendingEvmRecord(storage, identity)?.proof.kind,
        'reservation',
        'swap must be durably reserved before the wallet send begins',
      );
      const hash = await onSend();
      const finalized = finalizePendingEvmRecord(
        storage,
        reservation,
        { hash, kind: 'hash' },
      );
      assert.equal(finalized?.persisted, true);
      return finalized!.record;
    });
    if (!guarded.acquired || !guarded.value.submitted) return null;
    return guarded.value.value;
  };

  const monitorTrackedSwapFixture = async (
    record: ReturnType<typeof createPendingEvmRecord>,
    waitForReceipt: (hash: Hex) => Promise<TransactionReceipt>,
  ) => {
    while (true) {
      try {
        return await resumePendingEvmRecord(record, {
          waitForCallsStatus: async () => {
            throw new Error('direct fixture cannot use calls status');
          },
          waitForReceipt,
        });
      } catch (error) {
        if (!(error instanceof Error) || !/timeout/i.test(error.message)) throw error;
      }
    }
  };

  // Approval confirmation can be ambiguous after the hash is known. Retrying
  // must poll that exact hash and must never invoke the wallet send again.
  const approvalAmbiguityStorage = new MemoryStorage();
  const approvalIdentity = {
    accountAddress: '0x000000000000000000000000000000000000a501',
    chainId: 8453,
    intentKey: 'pixotchi-swap:approval:v1',
  };
  let approvalSends = 0;
  const approvalRecord = await submitTrackedSwapFixture({
    identity: approvalIdentity,
    onSend: async () => {
      approvalSends += 1;
      return directHash;
    },
    storage: approvalAmbiguityStorage,
  });
  assert.ok(approvalRecord);
  let approvalWaits = 0;
  const approvalReceipt = await monitorTrackedSwapFixture(
    approvalRecord,
    async (hash) => {
      approvalWaits += 1;
      assert.equal(hash, directHash);
      if (approvalWaits === 1) throw new Error('receipt timeout');
      return receiptFixture(canonicalBlockHash);
    },
  );
  assert.equal(approvalReceipt.blockHash, canonicalBlockHash);
  assert.equal(approvalSends, 1);
  assert.equal(approvalWaits, 2);
  assert.equal(removePendingEvmRecord(approvalAmbiguityStorage, approvalRecord), true);

  // The final swap has the same at-most-once rule: a receipt transport failure
  // resumes the stored proof instead of re-entering wallet submission.
  const swapAmbiguityStorage = new MemoryStorage();
  const swapIdentity = {
    accountAddress: '0x000000000000000000000000000000000000a502',
    chainId: 8453,
    intentKey: 'pixotchi-swap:execution:v1',
  };
  let swapSends = 0;
  const swapRecord = await submitTrackedSwapFixture({
    identity: swapIdentity,
    onSend: async () => {
      swapSends += 1;
      return directHash;
    },
    storage: swapAmbiguityStorage,
  });
  assert.ok(swapRecord);
  let swapWaits = 0;
  await monitorTrackedSwapFixture(swapRecord, async () => {
    swapWaits += 1;
    if (swapWaits === 1) throw new Error('receipt timeout');
    return receiptFixture(canonicalBlockHash);
  });
  assert.equal(swapSends, 1);
  assert.equal(swapWaits, 2);
  assert.equal(removePendingEvmRecord(swapAmbiguityStorage, swapRecord), true);

  // Two panels/tabs racing the same wallet share one registry-level submission
  // lease and pending-record scan. At most one callback may reach wallet send.
  const swapContenderStorage = new MemoryStorage();
  let contenderSends = 0;
  const contenderIdentity = {
    accountAddress: '0x000000000000000000000000000000000000a503',
    chainId: 8453,
    intentKey: 'pixotchi-swap:execution:v1',
  };
  const contenderSubmit = () => submitTrackedSwapFixture({
    identity: contenderIdentity,
    onSend: async () => {
      contenderSends += 1;
      return directHash;
    },
    storage: swapContenderStorage,
  });
  const contenderRecords = await Promise.all([contenderSubmit(), contenderSubmit()]);
  assert.equal(contenderSends, 1);
  assert.equal(contenderRecords.filter(Boolean).length, 1);
  assert.equal(
    removePendingEvmRecord(
      swapContenderStorage,
      contenderRecords.find(Boolean)!,
    ),
    true,
  );

  let unsafeSendCount = 0;
  await assert.rejects(
    withPendingEvmSubmissionGuard(
      unenumerableStorage,
      { accountAddress: pendingAccount, chainId: 8453 },
      async () => {
        unsafeSendCount += 1;
        return 'sent';
      },
    ),
    /browser storage/i,
  );
  assert.equal(unsafeSendCount, 0);

  // A Storage implementation can become restricted after the durable probe.
  // If key enumeration stops before an existing physical record is reached,
  // the registry is not authoritative and the wallet callback must stay at 0.
  const interruptedEnumerationStorage = new MidEnumerationThrowStorage();
  const interruptedEnumerationIdentity = {
    accountAddress: '0x000000000000000000000000000000000000e001',
    chainId: 8453,
    intentKey: 'smoke:interrupted-enumeration',
  };
  const interruptedEnumerationRecord = createPendingEvmRecord({
    attemptId: 'attempt-enumeration-1',
    callsDigest: pendingCallsDigest,
    identity: interruptedEnumerationIdentity,
    method: 'direct',
    proof: { kind: 'hash', hash: directHash },
  });
  const interruptedEnumerationKey = `${getPendingEvmStorageKey(
    interruptedEnumerationRecord,
  )}:attempt:${keccak256(stringToHex(interruptedEnumerationRecord.attemptId))}`;
  interruptedEnumerationStorage.setItem('smoke:unrelated-key', 'unrelated');
  // Store the raw physical record without populating the module's memory
  // mirror; otherwise the mirror could mask the omitted durable key.
  interruptedEnumerationStorage.setItem(
    interruptedEnumerationKey,
    JSON.stringify(interruptedEnumerationRecord),
  );
  let interruptedEnumerationSendCount = 0;
  try {
    await withPendingEvmSubmissionGuard(
      interruptedEnumerationStorage,
      interruptedEnumerationIdentity,
      async () => {
        interruptedEnumerationSendCount += 1;
        return 'sent';
      },
    );
  } catch (error) {
    assert.match(String(error), /browser storage/i);
  }
  assert.equal(interruptedEnumerationSendCount, 0);

  // Completing key enumeration is insufficient when the enumerated pending
  // candidate itself cannot be read. Memory fallback may keep UI locked, but
  // it must never authorize a fresh wallet submission.
  const unreadableCandidateStorage = new CandidateReadThrowStorage();
  const unreadableCandidateIdentity = {
    accountAddress: '0x000000000000000000000000000000000000e002',
    chainId: 8453,
    intentKey: 'smoke:unreadable-candidate',
  };
  const unreadableCandidateRecord = createPendingEvmRecord({
    attemptId: 'attempt-unreadable-1',
    callsDigest: pendingCallsDigest,
    identity: unreadableCandidateIdentity,
    method: 'direct',
    proof: { kind: 'hash', hash: directHash },
  });
  const unreadableCandidateKey = `${getPendingEvmStorageKey(
    unreadableCandidateRecord,
  )}:attempt:${keccak256(stringToHex(unreadableCandidateRecord.attemptId))}`;
  unreadableCandidateStorage.setItem(
    unreadableCandidateKey,
    JSON.stringify(unreadableCandidateRecord),
  );
  unreadableCandidateStorage.unreadableKey = unreadableCandidateKey;
  let unreadableCandidateSendCount = 0;
  await assert.rejects(
    withPendingEvmSubmissionGuard(
      unreadableCandidateStorage,
      unreadableCandidateIdentity,
      async () => {
        unreadableCandidateSendCount += 1;
        return 'sent';
      },
    ),
    /browser storage/i,
  );
  assert.equal(unreadableCandidateSendCount, 0);

  for (const sameLengthMutation of [false, true]) {
    const registryShiftKey = `smoke:registry-shift-${sameLengthMutation}`;
    const registryShiftStorage = new RegistryShiftStorage(
      registryShiftKey,
      sameLengthMutation ? `smoke:registry-replacement-${sameLengthMutation}` : null,
    );
    const registryShiftIdentity = {
      accountAddress: sameLengthMutation
        ? '0x000000000000000000000000000000000000e011'
        : '0x000000000000000000000000000000000000e010',
      chainId: 8453,
      intentKey: `smoke:registry-shift-${sameLengthMutation}`,
    };
    const registryShiftRecord = createPendingEvmRecord({
      attemptId: `attempt-registry-shift-${sameLengthMutation ? 'same' : 'delete'}`,
      callsDigest: pendingCallsDigest,
      identity: registryShiftIdentity,
      method: 'direct',
      proof: { kind: 'hash', hash: directHash },
    });
    const registryShiftRecordKey = `${getPendingEvmStorageKey(
      registryShiftRecord,
    )}:attempt:${keccak256(stringToHex(registryShiftRecord.attemptId))}`;
    registryShiftStorage.setItem(registryShiftKey, 'unrelated');
    registryShiftStorage.setItem(
      registryShiftRecordKey,
      JSON.stringify(registryShiftRecord),
    );
    let registryShiftSendCount = 0;
    const registryShiftResult = await withPendingEvmSubmissionGuard(
      registryShiftStorage,
      registryShiftIdentity,
      async () => {
        registryShiftSendCount += 1;
        return 'sent';
      },
    );
    assert.equal(registryShiftSendCount, 0);
    assert.equal(registryShiftResult.acquired, true);
    if (registryShiftResult.acquired) {
      assert.equal(registryShiftResult.value.submitted, false);
      if (!registryShiftResult.value.submitted) {
        assert.equal(registryShiftResult.value.blocker.attemptId, registryShiftRecord.attemptId);
      }
    }
  }

  // Lease claims use the same stable all-key snapshot. This fault storage
  // makes a legacy fixed-index scan omit a live incumbent in both the before
  // and after-write passes; the guarded callback must still remain at zero.
  const leaseShiftRegistry = {
    accountAddress: '0x000000000000000000000000000000000000e020',
    chainId: 8453,
  };
  const leaseShiftLogicalKey = [
    'pixotchi:pending-evm:v2:lease',
    leaseShiftRegistry.chainId,
    leaseShiftRegistry.accountAddress,
  ].join(':');
  const leaseShiftIncumbentToken = 'incumbent-lease-token';
  const leaseShiftIncumbentKey = `${leaseShiftLogicalKey}:claim:${leaseShiftIncumbentToken}`;
  const leaseShiftFirstKey = 'smoke:lease-shift-unrelated-1';
  const leaseShiftStorage = new LeaseClaimShiftStorage(
    leaseShiftFirstKey,
    leaseShiftIncumbentKey,
  );
  leaseShiftStorage.setItem(leaseShiftFirstKey, 'unrelated');
  leaseShiftStorage.setItem(
    leaseShiftIncumbentKey,
    JSON.stringify({
      expiresAt: Date.now() + 60_000,
      token: leaseShiftIncumbentToken,
    }),
  );
  leaseShiftStorage.arm();
  let leaseShiftCallbackCount = 0;
  const leaseShiftResult = await withPendingEvmSubmissionLease(
    leaseShiftStorage,
    leaseShiftRegistry,
    async () => {
      leaseShiftCallbackCount += 1;
      return 'unsafe';
    },
  );
  assert.equal(leaseShiftCallbackCount, 0);
  assert.equal(leaseShiftResult.acquired, false);
  assert.notEqual(leaseShiftStorage.getItem(leaseShiftIncumbentKey), null);

  // A background owner may renew the same claim key while another document
  // evaluates an expired snapshot. The changed value must survive and force
  // this admission attempt to fail closed.
  const renewedLeaseRegistry = {
    accountAddress: '0x000000000000000000000000000000000000e030',
    chainId: 8453,
  };
  const renewedLeaseLogicalKey = [
    'pixotchi:pending-evm:v2:lease',
    renewedLeaseRegistry.chainId,
    renewedLeaseRegistry.accountAddress,
  ].join(':');
  const renewedLeaseToken = 'renewed-lease-token';
  const renewedLeaseClaimKey = `${renewedLeaseLogicalKey}:claim:${renewedLeaseToken}`;
  const renewedLeaseRaw = JSON.stringify({
    expiresAt: Date.now() + 60_000,
    token: renewedLeaseToken,
  });
  const renewedLeaseStorage = new ReplaceValueOnReadStorage(
    renewedLeaseClaimKey,
    renewedLeaseRaw,
    3,
  );
  renewedLeaseStorage.setItem(
    renewedLeaseClaimKey,
    JSON.stringify({ expiresAt: Date.now() - 1, token: renewedLeaseToken }),
  );
  let renewedLeaseCallbackCount = 0;
  const renewedLeaseResult = await withPendingEvmSubmissionLease(
    renewedLeaseStorage,
    renewedLeaseRegistry,
    async () => {
      renewedLeaseCallbackCount += 1;
      return 'unsafe';
    },
  );
  assert.equal(renewedLeaseCallbackCount, 0);
  assert.equal(renewedLeaseResult.acquired, false);
  assert.equal(renewedLeaseStorage.getItem(renewedLeaseClaimKey), renewedLeaseRaw);

  // A stale reservation may be finalized under the same attempt-specific key
  // during a guard scan. The proof must remain a blocker and the guarded send
  // must stay at zero; proven attempts are never age-pruned.
  const finalizedDuringPruneIdentity = {
    accountAddress: '0x000000000000000000000000000000000000e031',
    chainId: 8453,
    intentKey: 'smoke:finalized-during-prune',
  };
  const expiredDuringPruneRecord = createPendingEvmRecord({
    attemptId: 'attempt-finalized-during-prune',
    callsDigest: pendingCallsDigest,
    identity: finalizedDuringPruneIdentity,
    method: 'direct',
    proof: { kind: 'reservation' },
    submittedAt: Date.now() - PREVIOUS_PENDING_EVM_AUTO_PRUNE_MS - 1,
  });
  const finalizedDuringPruneRecord = createPendingEvmRecord({
    attemptId: expiredDuringPruneRecord.attemptId,
    callsDigest: pendingCallsDigest,
    identity: finalizedDuringPruneIdentity,
    method: 'direct',
    proof: { kind: 'hash', hash: directHash },
  });
  const finalizedDuringPruneKey = `${getPendingEvmStorageKey(
    expiredDuringPruneRecord,
  )}:attempt:${keccak256(stringToHex(expiredDuringPruneRecord.attemptId))}`;
  const finalizedDuringPruneRaw = JSON.stringify(finalizedDuringPruneRecord);
  const finalizedDuringPruneStorage = new ReplaceValueOnReadStorage(
    finalizedDuringPruneKey,
    finalizedDuringPruneRaw,
    3,
  );
  finalizedDuringPruneStorage.setItem(
    finalizedDuringPruneKey,
    JSON.stringify(expiredDuringPruneRecord),
  );
  let finalizedDuringPruneSendCount = 0;
  const finalizedDuringPruneResult = await withPendingEvmSubmissionGuard(
    finalizedDuringPruneStorage,
    finalizedDuringPruneIdentity,
    async () => {
      finalizedDuringPruneSendCount += 1;
      return 'unsafe';
    },
  );
  assert.equal(finalizedDuringPruneSendCount, 0);
  assert.equal(finalizedDuringPruneResult.acquired, true);
  if (finalizedDuringPruneResult.acquired) {
    assert.equal(finalizedDuringPruneResult.value.submitted, false);
  }
  assert.equal(
    finalizedDuringPruneStorage.getItem(finalizedDuringPruneKey),
    finalizedDuringPruneRaw,
  );

  // A browser can suspend longer than the submission lease while contenders
  // are settling. An expired own claim is not ownership proof, even when all
  // competing claims are expired too, so the callback must never start.
  const realLeaseDateNow = Date.now;
  let suspendedLeaseNow = realLeaseDateNow();
  const suspendedLeaseStorage = new AdvanceClockOnClaimStorage(() => {
    suspendedLeaseNow += PENDING_EVM_HARD_LOCK_MS;
  });
  let suspendedLeaseCallbackCount = 0;
  let suspendedLeaseResult: Awaited<ReturnType<typeof withPendingEvmSubmissionLease<string>>>;
  Date.now = () => suspendedLeaseNow;
  try {
    suspendedLeaseResult = await withPendingEvmSubmissionLease(
      suspendedLeaseStorage,
      {
        accountAddress: '0x000000000000000000000000000000000000e032',
        chainId: 8453,
      },
      async () => {
        suspendedLeaseCallbackCount += 1;
        return 'unsafe';
      },
    );
  } finally {
    Date.now = realLeaseDateNow;
  }
  assert.equal(suspendedLeaseStorage.advanced, true);
  assert.equal(suspendedLeaseCallbackCount, 0);
  assert.equal(suspendedLeaseResult.acquired, false);

  const leaseStorage = new MemoryStorage();
  let leaseCallbacks = 0;
  const leaseRegistry = { accountAddress: pendingAccount, chainId: 8453 };
  const [firstLease, secondLease] = await Promise.all([
    withPendingEvmSubmissionLease(leaseStorage, leaseRegistry, async () => {
      leaseCallbacks += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return 'first';
    }),
    withPendingEvmSubmissionLease(leaseStorage, leaseRegistry, async () => {
      leaseCallbacks += 1;
      return 'second';
    }),
  ]);
  assert.equal(leaseCallbacks, 1);
  assert.equal([firstLease, secondLease].filter((result) => result.acquired).length, 1);

  const coordinatorStorage = new MemoryStorage();
  const coordinatorWindow = new class extends EventTarget {
    localStorage = coordinatorStorage;
    setTimeout = globalThis.setTimeout.bind(globalThis);
    clearTimeout = globalThis.clearTimeout.bind(globalThis);
  }();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: coordinatorWindow,
  });
  const {
    registerPendingEvmController,
  } = await import('../lib/pending-evm-coordinator');

  const coordinatorRegistry = {
    accountAddress: '0x000000000000000000000000000000000000c001',
    chainId: 8453,
  };
  const coordinatorIdentity = {
    ...coordinatorRegistry,
    intentKey: 'smoke:coordinator-exact',
  };
  const coordinatorRecord = createPendingEvmRecord({
    attemptId: 'attempt-coordinator-1',
    callsDigest: pendingCallsDigest,
    identity: coordinatorIdentity,
    method: 'direct',
    proof: { kind: 'hash', hash: directHash },
  });
  let exactRecoveries = 0;
  let genericFeedbackCount = 0;
  let secondGenericFeedbackCount = 0;
  const unregisterGeneric = registerPendingEvmController(coordinatorRegistry, {
    callsDigest: pendingCallsDigest,
    controllerId: 'generic-controller',
    intentDigest: getPendingEvmIntentDigest('smoke:other-controller'),
    onSnapshot: ({ feedbackRecord }) => {
      genericFeedbackCount = feedbackRecord ? 1 : 0;
    },
    recover: async () => { throw new Error('generic controller must not recover'); },
  });
  const unregisterSecondGeneric = registerPendingEvmController(coordinatorRegistry, {
    callsDigest: pendingCallsDigest,
    controllerId: 'generic-controller-2',
    intentDigest: getPendingEvmIntentDigest('smoke:other-controller-2'),
    onSnapshot: ({ feedbackRecord }) => {
      secondGenericFeedbackCount = feedbackRecord ? 1 : 0;
    },
    recover: async () => { throw new Error('generic controller must not recover'); },
  });
  const unregisterExact = registerPendingEvmController(coordinatorRegistry, {
    callsDigest: pendingCallsDigest,
    controllerId: 'exact-controller',
    intentDigest: coordinatorRecord.intentDigest,
    onSnapshot: () => {},
    recover: async (_record, signal) => {
      exactRecoveries += 1;
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
    },
  });
  writePendingEvmRecord(coordinatorStorage, coordinatorRecord);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(exactRecoveries, 1);
  assert.equal(genericFeedbackCount + secondGenericFeedbackCount, 0);

  // Unregistering the exact recovery owner aborts it immediately and hands the
  // durable proof to exactly one generic presenter, never N portaled toasts.
  unregisterExact();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(genericFeedbackCount + secondGenericFeedbackCount, 1);
  removePendingEvmRecord(coordinatorStorage, coordinatorRecord);
  unregisterGeneric();
  unregisterSecondGeneric();

  // First-mount reconciliation schedules a wake for an existing crashed-tab
  // submission lease even when no new storage event will arrive.
  const leaseWakeStorage = new MemoryStorage();
  const leaseWakeWindow = new class extends EventTarget {
    localStorage = leaseWakeStorage;
    setTimeout = globalThis.setTimeout.bind(globalThis);
    clearTimeout = globalThis.clearTimeout.bind(globalThis);
  }();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: leaseWakeWindow,
  });
  const leaseWakeRegistry = {
    accountAddress: '0x000000000000000000000000000000000000ca11',
    chainId: 8453,
  };
  leaseWakeStorage.setItem(
    `pixotchi:pending-evm:v2:lease:${leaseWakeRegistry.chainId}:${leaseWakeRegistry.accountAddress}`,
    JSON.stringify({ expiresAt: Date.now() + 80, token: 'lease-wake-token' }),
  );
  let leaseWakeLocked = false;
  const unregisterLeaseWake = registerPendingEvmController(leaseWakeRegistry, {
    callsDigest: pendingCallsDigest,
    controllerId: 'lease-wake-controller',
    intentDigest: getPendingEvmIntentDigest('smoke:lease-wake'),
    onSnapshot: ({ locked }) => { leaseWakeLocked = locked; },
    recover: async () => {},
  });
  await Promise.resolve();
  assert.equal(leaseWakeLocked, true);
  await new Promise((resolve) => setTimeout(resolve, 160));
  await Promise.resolve();
  assert.equal(leaseWakeLocked, false);
  unregisterLeaseWake();
  delete (globalThis as { window?: unknown }).window;

  // A wallet prompt still open (in this tab or another) holds the submission
  // lease, and must keep the shortened ambiguous window from unlocking beneath it.
  if (ambiguousAckFixture) {
    const { identity: ambiguousIdentity, record: agedReservation } = ambiguousAckFixture;
    const ackStorage = new MemoryStorage();
    writePendingEvmRecord(ackStorage, agedReservation);
    await withPendingEvmSubmissionLease(ackStorage, pendingIdentity, async () => {
      assert.equal(
        acknowledgePendingEvmRecord(ackStorage, agedReservation),
        false,
        'a live submission lease must block the ambiguous acknowledgement',
      );
    });
    assert.equal(acknowledgePendingEvmRecord(ackStorage, agedReservation), true);
    assert.equal(readPendingEvmRecord(ackStorage, ambiguousIdentity), null);
  }
}

void runAsyncPendingTransactionSmoke()
  .then(() => console.log('production-fixes smoke passed'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
