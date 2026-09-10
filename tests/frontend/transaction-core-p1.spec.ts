import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import path from 'node:path';

let bundle: string;
test.beforeAll(async () => {
  const result = await build({
    entryPoints: [path.resolve('tests/frontend/fixtures/transaction-core.tsx')],
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"test"', 'process.env': '{}' },
    plugins: [{ name: 'wallet-io-only', setup(builder) {
      builder.onResolve({ filter: /^(wagmi(?:\/experimental)?|@vercel\/analytics|@\/lib\/(base-rpc|smart-wallet-context|owner-resource-invalidation|open-external))$/ }, () => ({
        path: path.resolve('tests/frontend/fixtures/transaction-core-wallet.ts'),
      }));
      builder.onResolve({ filter: /(^|\/)base-rpc$/ }, () => ({ path: path.resolve('tests/frontend/fixtures/transaction-core-wallet.ts') }));
      builder.onResolve({ filter: /^@\/components\/transactions\/game-transaction$/ }, () => ({ path: path.resolve('tests/frontend/fixtures/transaction-game-mock.tsx') }));
    } }],
  });
  bundle = result.outputFiles[0].text;
});
test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => console.error('Transaction fixture error:', error.message));
  // The production controller runs unchanged. Only wallet/RPC/provider I/O is
  // mocked; its durable storage, coordinator, submission gates and cleanup run.
  await page.route('http://transaction-core.test/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/staking/balance') return route.fulfill({ json: { success: true, balance: '10000000000000000000' } });
    if (url.pathname === '/api/staking/info') return route.fulfill({ json: { success: true, allowance: '10000000000000000000', approved: true, stake: { staked: '5000000000000000000', rewards: '100' } } });
    return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
  });
  await page.goto('http://transaction-core.test/');
  await page.addScriptTag({ content: bundle });
  // This isolated behavior harness does not load Tailwind. Radix disables body
  // hit testing; production restores it through the dialog's utility class.
  await page.addStyleTag({ content: '[role="dialog"] { position: fixed; inset: 0; overflow: auto; background: white; } [data-dialog-layout] { pointer-events: auto; }' });
  await expect(page.getByRole('button', { name: 'Submit', exact: true })).toBeEnabled();
});

test('TX-01 real staking dialog preserves intermediate input without constructing invalid calls', async ({ page }) => {
  await page.getByRole('button', { name: 'Open staking' }).click();
  const dialog = page.getByRole('dialog', { name: 'Stake SEED' });
  await expect(dialog.getByRole('button', { name: 'Stake', exact: true })).toBeDisabled();
  for (const mode of ['Stake', 'Unstake']) {
    await dialog.getByRole('radio', { name: mode, exact: true }).click();
    const input = dialog.getByRole('textbox', { name: `Amount to ${mode.toLowerCase()}` });
    for (const draft of ['.', '', '1,5', '-', 'abc', '1e2', '0.0000000000000000001']) {
      await input.fill(draft);
      await expect(input).toHaveValue(draft);
      await expect(dialog.getByLabel(`${mode} call amount`, { exact: true })).toHaveText('none');
      await expect(dialog.getByRole('button', { name: mode, exact: true })).toBeDisabled();
    }
    await input.fill('1.000000000000000001');
    await expect(dialog.getByLabel(`${mode} call amount`, { exact: true })).toHaveText('1000000000000000001');
    await expect(dialog.getByRole('button', { name: mode, exact: true })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Use maximum SEED', exact: true }).click();
    await expect(dialog.getByLabel(`${mode} call amount`, { exact: true })).toHaveText(mode === 'Stake' ? '10000000000000000000' : '5000000000000000000');
  }
});

test('TX-02 unsupported atomicity reports an error, releases busy state, and can retry', async ({ page }) => {
  await page.getByLabel('Capabilities').selectOption('unsupported');
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page.getByLabel('Error', { exact: true })).toContainText('atomic bundled transactions');
  await expect(page.getByLabel('Executing', { exact: true })).toHaveText('false');
  await expect(page.getByLabel('Wallet calls', { exact: true })).toHaveText('0');
  await page.getByLabel('Capabilities').selectOption('supported');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByLabel('Wallet calls', { exact: true })).toHaveText('1');
  await expect(page.getByLabel('Executing', { exact: true })).toHaveText('false');
});

for (const mode of ['missing', 'failure', 'supported']) test(`TX-02 ${mode} capabilities let the wallet enforce atomic execution`, async ({ page }) => {
  await page.getByLabel('Capabilities').selectOption(mode);
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page.getByLabel('Wallet calls', { exact: true })).toHaveText('1');
  await expect(page.getByLabel('Executing', { exact: true })).toHaveText('false');
});

test('TX-02 unmount during capability discovery never opens the wallet', async ({ page }) => {
  await page.getByLabel('Capabilities').selectOption('deferred');
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page.getByLabel('Executing', { exact: true })).toHaveText('true');
  await page.getByRole('button', { name: 'Toggle controller' }).click();
  await page.getByRole('button', { name: 'Resolve capabilities' }).click();
  await page.getByRole('button', { name: 'Toggle controller' }).click();
  await expect(page.getByRole('button', { name: 'Submit', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Wallet calls', { exact: true })).toHaveText('0');
});

test('TX-02 supported atomic submission completes with canonical receipt proof', async ({ page }) => {
  await page.getByLabel('Reject wallet', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page.getByLabel('Status', { exact: true })).toHaveText('success');
  await expect(page.getByLabel('Executing', { exact: true })).toHaveText('false');
  await expect(page.getByLabel('Wallet calls', { exact: true })).toHaveText('1');
});

for (const direct of [false, true]) {
  for (const [replacement, expectedStatus] of [['repriced', 'success'], ['replaced', 'superseded'], ['cancelled', 'cancelled']]) {
    test(`TX-08 ${direct ? 'direct' : 'batch'} ${replacement} preserves the original action outcome`, async ({ page }) => {
      await page.getByLabel('Reject wallet', { exact: true }).uncheck();
      if (direct) await page.getByLabel('Direct transaction', { exact: true }).check();
      await page.getByLabel('Replacement', { exact: true }).selectOption(replacement);
      await page.getByRole('button', { name: 'Submit', exact: true }).click();
      await expect(page.getByLabel('Status', { exact: true })).toHaveText(expectedStatus);
      await expect(page.getByLabel('Confirmation calls', { exact: true })).toHaveText(expectedStatus === 'success' ? '1' : '0');
      await expect(page.getByLabel('Superseded events', { exact: true })).toHaveText(expectedStatus === 'superseded' ? '1' : '0');
      await expect(page.getByLabel('Wallet calls', { exact: true })).toHaveText('1');
      await expect(page.getByLabel('Executing', { exact: true })).toHaveText('false');
    });
  }
}

for (const direct of [false, true]) for (const [replacement, expectedStatus] of [['repriced', 'success'], ['replaced', 'superseded'], ['cancelled', 'cancelled']]) {
  test(`TX-08 reload retains ${direct ? 'direct' : 'batch'} ${replacement} disposition`, async ({ page }) => {
    await page.getByLabel('Reject wallet', { exact: true }).uncheck();
    if (direct) await page.getByLabel('Direct transaction', { exact: true }).check();
    await page.getByLabel('Replacement', { exact: true }).selectOption(replacement);
    await page.getByLabel('Delay next receipt', { exact: true }).check();
    await page.getByRole('button', { name: 'Submit', exact: true }).click();
    await expect.poll(() => page.evaluate(() => Object.entries(localStorage)
      .filter(([key]) => key.startsWith('pixotchi:pending-evm:v2:record:'))
      .map(([, value]) => JSON.parse(value).replacement?.disposition)))
      .toEqual([replacement === 'repriced' ? 'repriced' : expectedStatus]);
    await page.reload();
    // A closed document's durable monitor lease expires after twenty seconds.
    await page.clock.install();
    await page.clock.fastForward(25_000);
    await page.addScriptTag({ content: bundle });
    // The new fixture renders two unrelated draft calls. The durable method
    // still owns direct status recovery and must never submit that fresh draft.
    await expect(page.getByLabel('Status', { exact: true })).toHaveText(expectedStatus);
    await expect(page.getByLabel('Confirmation calls', { exact: true })).toHaveText(expectedStatus === 'success' ? '1' : '0');
    await expect(page.getByLabel('Wallet calls', { exact: true })).toHaveText('0');
  });
}

test('TX-09 stale acknowledgement releases only the reviewed attempt', async ({ page }) => {
  await page.getByRole('button', { name: 'Seed stale reservation', exact: true }).click();
  await expect(page.getByLabel('Status', { exact: true })).toHaveText('transactionStale');
  await page.getByText('More options', { exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByLabel('Status', { exact: true })).toHaveText('idle');
  await expect(page.getByRole('button', { name: 'Submit', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Wallet calls', { exact: true })).toHaveText('0');
  await expect(page.getByLabel('Acknowledgement events', { exact: true })).toHaveText('1');
});

for (const direct of [false, true]) test(`TX-09 captured ${direct ? 'direct' : 'batch'} proof becomes durable while its receipt monitor is waiting`, async ({ page }) => {
  await page.getByLabel('Reject wallet', { exact: true }).uncheck();
  if (direct) await page.getByLabel('Direct transaction', { exact: true }).check();
  await page.getByLabel('Delay next receipt', { exact: true }).check();
  await page.evaluate(() => {
    const write = Storage.prototype.setItem;
    (window as typeof window & { restoreProofWrites: () => void }).restoreProofWrites = () => {
      Storage.prototype.setItem = write;
    };
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('pixotchi:pending-evm:v2:record:') && JSON.parse(value).proof.kind !== 'reservation') {
        throw new DOMException('Temporary proof write failure', 'QuotaExceededError');
      }
      return write.call(this, key, value);
    };
  });
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  const proofs = () => page.evaluate(() => Object.entries(localStorage)
    .filter(([key]) => key.startsWith('pixotchi:pending-evm:v2:record:'))
    .map(([, value]) => { const record = JSON.parse(value); return { kind: record.proof.kind, proofCaptured: record.proofCaptured === true }; }));
  await expect.poll(proofs).toEqual([{ kind: 'reservation', proofCaptured: true }]);
  await page.evaluate(() => (window as typeof window & { restoreProofWrites: () => void }).restoreProofWrites());
  await expect.poll(proofs).toEqual([{ kind: direct ? 'hash' : 'calls', proofCaptured: false }]);
  await expect(page.getByLabel('Executing', { exact: true })).toHaveText('true');
  await expect(page.getByLabel('Confirmation calls', { exact: true })).toHaveText('0');
  await page.getByRole('button', { name: 'Resolve receipt', exact: true }).click();
  await expect(page.getByLabel('Status', { exact: true })).toHaveText('success');
  await expect(page.getByLabel('Confirmation calls', { exact: true })).toHaveText('1');
  await expect.poll(proofs).toEqual([]);
});

test('TX-09 an awaited acknowledgement cannot clear the newly connected wallet', async ({ page }) => {
  await page.getByRole('button', { name: 'Seed stale reservation', exact: true }).click();
  await expect(page.getByLabel('Status', { exact: true })).toHaveText('transactionStale');
  await page.getByText('More options', { exact: true }).click();
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1_000));
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Direct acknowledgement entry', exact: true }).click();
  await page.getByRole('button', { name: 'Direct acknowledgement entry', exact: true }).click();
  await page.getByRole('button', { name: 'Switch wallet', exact: true }).click();
  await expect(page.getByLabel('Status', { exact: true })).toHaveText('idle');
  await page.clock.fastForward(1_000);
  await expect(page.getByRole('button', { name: 'Submit', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await page.clock.fastForward(1_000);
  await expect(page.getByLabel('Status', { exact: true })).toHaveText('transactionRejected');
  await expect(page.getByLabel('Wallet calls', { exact: true })).toHaveText('1');
  await expect(page.getByLabel('Acknowledgement events', { exact: true })).toHaveText('1');
});

test('TX-03 invalid current readiness blocks both toast and direct retry', async ({ page }) => {
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page.getByLabel('Wallet calls', { exact: true })).toHaveText('1');
  await page.getByLabel('Ready', { exact: true }).uncheck();
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Direct retry entry' }).click();
  await expect(page.getByLabel('Error', { exact: true })).toContainText('required fields');
  await expect(page.getByLabel('Wallet calls', { exact: true })).toHaveText('1');
});

test('TX-03 ambiguous reservation survives invalid form, changed draft and retained submission callbacks', async ({ page }) => {
  const records = () => page.evaluate(() => Object.entries(localStorage)
    .filter(([key]) => key.startsWith('pixotchi:pending-evm:v2:record:')).sort(([a], [b]) => a.localeCompare(b)));
  await page.getByLabel('Ambiguous wallet result', { exact: true }).check();
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page.getByLabel('Status', { exact: true })).toHaveText('submissionAmbiguous');
  await expect(page.getByLabel('Executing', { exact: true })).toHaveText('false');
  const pending = await records();
  expect(pending).toHaveLength(1);
  expect(JSON.parse(pending[0][1]).proof.kind).toBe('reservation');
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0);

  await page.getByLabel('Ready', { exact: true }).uncheck();
  await page.getByLabel('Draft', { exact: true }).fill('0x03');
  for (const veto of ['false', 'throw']) {
    await page.getByRole('combobox', { name: 'Preflight', exact: true }).selectOption(veto);
    for (const entry of ['Direct retry entry', 'Direct submit entry']) {
      await page.getByRole('button', { name: entry, exact: true }).click();
      await expect(page.getByLabel('Status', { exact: true })).toHaveText('submissionAmbiguous');
      expect(await records()).toEqual(pending);
      await expect(page.getByLabel('Wallet calls', { exact: true })).toHaveText('1');
      await expect(page.getByLabel('Preflight calls', { exact: true })).toHaveText('1');
    }
    await page.getByLabel('Ready', { exact: true }).check();
  }
});

test('TX-03 a rejected async validator preserves a reservation acquired during its wait', async ({ page }) => {
  const records = () => page.evaluate(() => Object.entries(localStorage)
    .filter(([key]) => key.startsWith('pixotchi:pending-evm:v2:record:')).sort(([a], [b]) => a.localeCompare(b)));
  await page.getByRole('combobox', { name: 'Preflight', exact: true }).selectOption('async');
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page.getByLabel('Executing', { exact: true })).toHaveText('true');
  await page.getByRole('button', { name: 'Reserve wallet elsewhere', exact: true }).click();
  await expect(page.getByLabel('Status', { exact: true })).toHaveText('submissionAmbiguous');
  const pending = await records();
  expect(pending).toHaveLength(1);
  await page.getByRole('button', { name: 'Reject preflight', exact: true }).click();
  await expect(page.getByLabel('Executing', { exact: true })).toHaveText('false');
  await expect(page.getByLabel('Status', { exact: true })).toHaveText('submissionAmbiguous');
  expect(await records()).toEqual(pending);
  await expect(page.getByLabel('Wallet calls', { exact: true })).toHaveText('0');
});

test('TX-03 delayed confirmed reconciliation from wallet A cannot block wallet B', async ({ page }) => {
  await page.getByLabel('Reject wallet', { exact: true }).uncheck();
  await page.getByRole('combobox', { name: 'Reconciliation', exact: true }).selectOption('failed');
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page.getByLabel('Status', { exact: true })).toHaveText('confirmedSyncing');
  await expect(page.getByLabel('Executing', { exact: true })).toHaveText('false');
  await page.getByLabel('Reject wallet', { exact: true }).check();
  await page.getByRole('button', { name: 'Switch wallet', exact: true }).click();
  await expect(page.getByLabel('Status', { exact: true })).toHaveText('idle');
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page.getByLabel('Wallet calls', { exact: true })).toHaveText('2');
  await expect(page.getByLabel('Status', { exact: true })).toHaveText('transactionRejected');
});

test('TX-03 a late wallet A send response preserves its proof without overwriting wallet B', async ({ page }) => {
  await page.getByLabel('Reject wallet', { exact: true }).uncheck();
  await page.getByLabel('Delay next wallet request', { exact: true }).check();
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page.getByLabel('Executing', { exact: true })).toHaveText('true');
  await expect(page.getByLabel('Wallet calls', { exact: true })).toHaveText('1');
  await page.getByLabel('Reject wallet', { exact: true }).check();
  await page.getByRole('button', { name: 'Switch wallet', exact: true }).click();
  await expect(page.getByLabel('Executing', { exact: true })).toHaveText('false');
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page.getByLabel('Status', { exact: true })).toHaveText('transactionRejected');
  await page.getByRole('button', { name: 'Resolve wallet request', exact: true }).click();
  await expect(page.getByLabel('Status', { exact: true })).toHaveText('transactionRejected');
  await expect(page.getByLabel('Executing', { exact: true })).toHaveText('false');
  await expect.poll(() => page.evaluate(() => Object.entries(localStorage)
    .filter(([key]) => key.startsWith('pixotchi:pending-evm:v2:record:'))
    .map(([, value]) => { const record = JSON.parse(value); return { account: record.accountAddress, proof: record.proof.kind }; })))
    .toEqual([{ account: `0x${'1'.repeat(40)}`, proof: 'calls' }]);
  await expect(page.getByLabel('Wallet calls', { exact: true })).toHaveText('2');
});

for (const outcome of ['Resolve', 'Reject']) test(`TX-03 late ${outcome.toLowerCase()} from wallet A cannot replace wallet B state`, async ({ page }) => {
  await page.getByLabel('Reject wallet', { exact: true }).uncheck();
  await page.getByRole('combobox', { name: 'Reconciliation', exact: true }).selectOption('deferred');
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page.getByLabel('Status', { exact: true })).toHaveText('confirmedSyncing');
  await expect(page.getByLabel('Executing', { exact: true })).toHaveText('true');
  await page.getByLabel('Reject wallet', { exact: true }).check();
  await page.getByRole('button', { name: 'Switch wallet', exact: true }).click();
  await expect(page.getByLabel('Executing', { exact: true })).toHaveText('false');
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page.getByLabel('Status', { exact: true })).toHaveText('transactionRejected');
  await page.getByRole('button', { name: `${outcome} reconciliation`, exact: true }).click();
  await expect(page.getByLabel('Status', { exact: true })).toHaveText('transactionRejected');
  await expect(page.getByLabel('Executing', { exact: true })).toHaveText('false');
  await expect(page.getByLabel('Wallet calls', { exact: true })).toHaveText('2');
});

for (const mode of ['false', 'throw']) test(`TX-03 ${mode} preflight veto stops submission and remains recoverable`, async ({ page }) => {
  await page.getByRole('combobox', { name: 'Preflight', exact: true }).selectOption(mode);
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page.getByLabel('Status', { exact: true })).toHaveText('buildError');
  await expect(page.getByLabel('Executing', { exact: true })).toHaveText('false');
  await expect(page.getByLabel('Wallet calls', { exact: true })).toHaveText('0');
  await page.getByRole('combobox', { name: 'Preflight', exact: true }).selectOption('allow');
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page.getByLabel('Wallet calls', { exact: true })).toHaveText('1');
});

test('TX-03 retry revalidates with the current callback and changed drafts require review', async ({ page }) => {
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page.getByLabel('Wallet calls', { exact: true })).toHaveText('1');
  await page.getByRole('combobox', { name: 'Preflight', exact: true }).selectOption('throw');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByLabel('Error', { exact: true })).toHaveText('Fresh validation failed');
  await expect(page.getByLabel('Wallet calls', { exact: true })).toHaveText('1');
  await page.getByRole('combobox', { name: 'Preflight', exact: true }).selectOption('allow');
  await page.getByLabel('Draft', { exact: true }).fill('0x03');
  await page.getByRole('button', { name: 'Direct retry entry' }).click();
  await expect(page.getByLabel('Error', { exact: true })).toContainText('use the main action');
  await expect(page.getByLabel('Wallet calls', { exact: true })).toHaveText('1');
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page.getByLabel('Wallet calls', { exact: true })).toHaveText('2');
});

test('TX-03 an async preflight cannot send a changed draft or be entered twice', async ({ page }) => {
  await page.getByRole('combobox', { name: 'Preflight', exact: true }).selectOption('async');
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await page.getByRole('button', { name: 'Direct retry entry' }).click();
  await expect(page.getByLabel('Preflight calls', { exact: true })).toHaveText('1');
  await page.getByLabel('Draft', { exact: true }).fill('0x03');
  await page.getByRole('button', { name: 'Resolve preflight' }).click();
  await expect(page.getByLabel('Error', { exact: true })).toContainText('changed during validation');
  await expect(page.getByLabel('Executing', { exact: true })).toHaveText('false');
  await expect(page.getByLabel('Wallet calls', { exact: true })).toHaveText('0');
});

test('TX-03 a synchronous pending flag does not veto its own accepted click', async ({ page }) => {
  await page.getByRole('combobox', { name: 'Preflight', exact: true }).selectOption('pending');
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page.getByLabel('Wallet calls', { exact: true })).toHaveText('1');
  await expect(page.getByLabel('Executing', { exact: true })).toHaveText('false');
});

test('TX-07 immutable transfer review survives close/reopen and describes partial progress', async ({ page }) => {
  const review = page.getByRole('region', { name: 'Transfer review' });
  await expect(review).toContainText('Plants (1): #17');
  await expect(review).toContainText('Network: Base');
  await expect(review).toContainText(`0x${'4'.repeat(40)}`);
  await page.getByRole('button', { name: 'Toggle review' }).click();
  await page.getByRole('button', { name: 'Toggle review' }).click();
  await expect(review).toContainText('Plants (1): #17');
  await page.getByRole('button', { name: 'Complete first transfer' }).click();
  await expect(review).toContainText('This transactionLands (1): #1112');
  await expect(review).toContainText('Already transferredPlants (1): #17');
});

test('TX-07 actual transfer dialog retains committed assets through Escape, reopen, reload and cancellation', async ({ page }) => {
  const key = `pixotchi:transfer-assets:v1:8453:0x${'1'.repeat(40)}`;
  await page.evaluate(({ key }) => localStorage.setItem(key, JSON.stringify({
    version: 1, accountAddress: `0x${'1'.repeat(40)}`, targetAddress: `0x${'4'.repeat(40)}`, chainId: 8453,
    planId: 'regression-review-plan', createdAt: Date.now(), phase: 'ready', nextStepIndex: 0,
    steps: [{ kind: 'land', landId: '1112' }], successfulPlantIds: [], successfulLandIds: [], failedPlantIds: [], failedLandIds: [],
  })), { key });
  await page.getByRole('button', { name: 'Open transfer', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirm Transfer', exact: true });
  await expect(dialog).toContainText('Lands (1): #1112');
  await expect(dialog).toContainText(`0x${'4'.repeat(40)}`);
  await expect(dialog.getByRole('button', { name: 'Confirm & Send' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Open transfer', exact: true }).click();
  await expect(dialog).toContainText('Lands (1): #1112');
  await page.reload();
  await page.addScriptTag({ content: bundle });
  await page.addStyleTag({ content: '[role="dialog"] { position: fixed; inset: 0; overflow: auto; background: white; } [data-dialog-layout] { pointer-events: auto; }' });
  await page.getByRole('button', { name: 'Open transfer', exact: true }).click();
  await expect(dialog).toContainText('Lands (1): #1112');
  await expect(dialog.getByRole('button', { name: 'Confirm & Send' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Transfer Assets', exact: true })).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBeNull();
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Wallet calls', { exact: true })).toHaveText('0');
});
