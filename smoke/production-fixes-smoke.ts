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

const blackjackDialog = projectFile('components/transactions/BlackjackDialog.tsx');
assert.match(blackjackDialog, /mobileMode="center"/);
assert.doesNotMatch(blackjackDialog, /mobileMode="sheet"/);
assert.match(blackjackDialog, /hideCloseButton/);
assert.match(blackjackDialog, /<DialogTitle className="sr-only">Blackjack<\/DialogTitle>/);
assert.match(blackjackDialog, /Close Blackjack dialog/);
assert.doesNotMatch(blackjackDialog, /<DialogHeader/);

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

for (const transactionWrapper of [
  'components/transactions/sponsored-transaction.tsx',
  'components/transactions/smart-wallet-transaction.tsx',
  'components/transactions/universal-transaction.tsx',
]) {
  const source = projectFile(transactionWrapper);
  assert.match(source, /feedbackMode \?\? \(showToast \? "toast" : "inline"\)/);
  assert.doesNotMatch(source, /feedbackMode \?\? \(showToast \? "both"/);
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
