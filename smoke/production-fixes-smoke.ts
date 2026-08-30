import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  encodeAbiParameters,
  keccak256,
  numberToHex,
  padHex,
  parseAbiParameters,
  toBytes,
  type Hex,
} from 'viem';
import { extractBestSpinRewardFromLogs } from '../lib/spin-game-events';

const projectFile = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

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
assert.doesNotMatch(arcade, /feedbackMode="inline"/);
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

const aboutTab = projectFile('components/tabs/about-tab.tsx');
assert.doesNotMatch(aboutTab, /Documentation/);
assert.doesNotMatch(aboutTab, /doc\.pixotchi\.tech/);

const appPage = projectFile('app/(game)/page.tsx');
assert.match(appPage, /function SharedFarmMintMobileToggle/);
assert.match(appPage, /data-shared-farm-mint-toggle/);
assert.match(appPage, /setMintType\(nextValue === 'lands' \? 'land' : 'plant'\)/);

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
  'components/transactions/smart-wallet-transaction.tsx',
  'components/transactions/universal-transaction.tsx',
]) {
  const source = projectFile(transactionWrapper);
  assert.match(source, /feedbackMode \?\? "toast"/);
  assert.match(source, /const showGlobalToast = resolvedFeedbackMode !== "none"/);
  assert.doesNotMatch(source, /feedbackMode \?\? \(showToast \? "both"/);
  assert.doesNotMatch(source, /feedbackMode \?\? \(showToast \? "toast" : "inline"\)/);
}

for (const toastOnlyTransaction of [
  'components/transactions/blackjack-transaction.tsx',
  'components/transactions/claim-rewards-transaction.tsx',
  'components/transactions/plant-name-transaction.tsx',
]) {
  const source = projectFile(toastOnlyTransaction);
  assert.match(source, /<GlobalTransactionToast \/>/);
  assert.doesNotMatch(source, /<TransactionStatus \/>/);
}

const swapPanel = projectFile('components/tabs/pixotchi-swap-panel.tsx');
assert.match(swapPanel, /hasInsufficientGas/);
assert.match(swapPanel, /S\.errors\.insufficientGas/);

const aiContext = projectFile('lib/ai-context.ts');
assert.match(aiContext, /plant statusLabel/);
assert.match(aiContext, /Do not paraphrase it into a different health word/);

console.log('production-fixes smoke passed');
