import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { expectSignedSession } from './helpers/public-session';

const TABS = ['Farm', 'Mint', 'Activity', 'Ranking', 'Swap', 'About'] as const;
const TRANSACTION_METHODS = new Set(['eth_sendTransaction', 'eth_sendRawTransaction', 'wallet_sendCalls', 'eth_sendUserOperation']);

// Console errors can contain RPC URLs, auth tokens or 32-byte values. Save only
// a bounded, sanitized message; never arguments, payloads, stacks or storage.
function publicError(message: string) {
  return message
    .replace(/https?:\/\/[^\s"'<>]+/g, value => {
      try {
        const url = new URL(value);
        return `${url.origin}${url.hostname === 'localhost' || url.hostname === '127.0.0.1' ? url.pathname : '/[redacted path]'}`;
      } catch { return '[url]'; }
    })
    .replace(/0x[\da-f]{64,}/gi, '[redacted hex data]')
    .replace(/\beyJ[\w-]+\.[\w-]+(?:\.[\w-]+)?\b/g, '[redacted token]')
    .replace(/((?:api[_-]?key|private[_-]?key|authorization|token|secret)\s*[:=]\s*)[^\s,;]+/gi, '$1[redacted]')
    .split('\n')[0]
    .slice(0, 600);
}

async function screenshot(page: Page, testInfo: TestInfo, name: string) {
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), animations: 'disabled', caret: 'hide' });
}

async function openWallet(page: Page) {
  await page.getByRole('button', { name: 'Open wallet profile', exact: true }).click();
  const wallet = page.getByRole('dialog', { name: 'Wallet Profile', exact: true });
  await expect(wallet).toBeVisible();
  return wallet;
}

test('local wallet completes navigation, safe drafts, transfer review recovery and reconnect', async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const failedApiRequests: Array<{ method: string; path: string; status: number }> = [];
  const submittedMethods: string[] = [];
  const completedSteps: string[] = [];
  let selfAddress = '';
  let selectedLandId = '';
  page.on('pageerror', error => pageErrors.push(publicError(error.message)));
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(publicError(message.text()));
  });
  page.on('response', response => {
    if (response.status() < 400) return;
    const pathname = new URL(response.url()).pathname;
    if (!pathname.startsWith('/api/')) return;
    failedApiRequests.push({
      method: response.request().method(),
      path: pathname.replace(/0x[\da-f]{40,}/gi, '[redacted identifier]'),
      status: response.status(),
    });
  });
  page.on('request', request => {
    if (request.method() !== 'POST') return;
    try {
      const payload: unknown = request.postDataJSON();
      for (const entry of Array.isArray(payload) ? payload : [payload]) {
        if (entry && typeof entry === 'object' && 'method' in entry && typeof entry.method === 'string' && TRANSACTION_METHODS.has(entry.method)) {
          submittedMethods.push(entry.method);
        }
      }
    } catch { /* Non-JSON app requests are not transaction RPC envelopes. */ }
  });

  try {
    await test.step('Connect through the real Local Test Wallet login path', async () => {
      await page.goto('/');
      await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
      await page.getByRole('button', { name: 'Local Test Wallet', exact: true }).click();
      await expect(page.locator('[data-connected=true]')).toBeVisible({ timeout: 60_000 });
      // Fresh browser contexts get the real first-visit tutorial.
      await page.getByRole('dialog', { name: /Pixotchi tutorial/ }).getByRole('button', { name: 'Skip', exact: true }).click();
      await expect(page.getByRole('dialog', { name: /Pixotchi tutorial/ })).toBeHidden();
      // Switching auth surfaces reloads the document, so hide dev-only chrome
      // after that navigation as well. Production UI remains untouched.
      await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
      await expect(page.getByRole('button', { name: 'Open wallet profile', exact: true })).toBeVisible();
      await expectSignedSession(page);
      completedSteps.push('connected Local Test Wallet and dismissed real onboarding');
      completedSteps.push('server accepted and retained the actual signed session');
    });

    await test.step('Select the application theme through its real menu', async () => {
      const theme = testInfo.project.name === 'app-desktop-1440' ? 'Dark' : 'Light';
      await page.getByRole('button', { name: /^Current theme:/ }).click();
      const choice = page.getByRole('menuitemradio', { name: theme, exact: true });
      await choice.click();
      await expect(choice).toHaveAttribute('aria-checked', 'true');
      await page.keyboard.press('Escape');
      await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${theme.toLowerCase()}\\b`));
      completedSteps.push(`selected actual ${theme} application theme`);
    });

    await test.step('Open all six real application tabs', async () => {
      for (const name of TABS) {
        await page.getByRole('tab', { name, exact: true }).click();
        const panel = page.getByRole('tabpanel', { name, exact: true });
        await expect(panel).toBeVisible();
        await expect(panel).not.toHaveText(/^\s*Loading(?:\s+[^.]+)?\.{3}\s*$/);
        await expect.poll(async () => (await panel.innerText()).trim().length).toBeGreaterThan(30);
        await expect(panel).not.toContainText(`Failed to load ${name}`);
        await expect(page.getByText('We hit a temporary app error', { exact: true })).toHaveCount(0);
        await screenshot(page, testInfo, `tab-${name.toLowerCase()}`);
        completedSteps.push(`opened ${name}`);
      }
    });

    await test.step('Reach balances by keyboard and use the connected tablet width', async () => {
      const balances = page.getByRole('group', { name: 'Token balances', exact: true });
      await balances.focus();
      await expect(balances).toBeFocused();
      const overflows = await balances.evaluate(node => node.scrollWidth > node.clientWidth + 1);
      if (overflows) {
        await balances.evaluate(node => { node.scrollLeft = 0; });
        await page.keyboard.press('ArrowRight');
        await expect.poll(() => balances.evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
      }
      if (testInfo.project.name === 'app-tablet-820') {
        expect((await page.locator('.app-shell-inner[data-connected=true]').boundingBox())!.width).toBeGreaterThan(700);
      }
      completedSteps.push('keyboard focus and horizontal balance scrolling; connected shell width verified');
    });

    await test.step('Invalid Stake and Unstake drafts keep the real application mounted', async () => {
      await page.getByRole('button', { name: 'Open staking dialog', exact: true }).click();
      const staking = page.getByRole('dialog', { name: /Stake SEED$/ });
      await expect(staking).toBeVisible();
      for (const action of ['Stake', 'Unstake'] as const) {
        await staking.getByRole('radio', { name: action, exact: true }).click();
        const input = staking.getByRole('textbox', { name: new RegExp(`Amount to ${action.toLowerCase()}`) });
        await input.fill('.');
        await expect(input).toHaveValue('.');
        await expect(staking).toBeVisible();
        await expect(staking.getByText('Enter a valid amount (max 18 decimals)', { exact: true })).toBeVisible();
        const submit = staking.getByRole('button', { name: action, exact: true });
        // Unapproved staking shows its separate approval action. Never click it.
        if (await submit.count()) await expect(submit).toBeDisabled();
        await expect(page.getByText('We hit a temporary app error', { exact: true })).toHaveCount(0);
        await screenshot(page, testInfo, `${action.toLowerCase()}-invalid-dot`);
        await input.fill('');
        completedSteps.push(`${action} invalid '.' retained dialog and app`);
      }
      await page.keyboard.press('Escape');
      await expect(staking).toBeHidden();
    });

    await test.step('Prepare one owned land to self and recover its unchanged review without sending', async () => {
      const wallet = await openWallet(page);
      await wallet.getByRole('button', { name: 'Copy wallet address', exact: true }).click();
      selfAddress = await page.evaluate(() => navigator.clipboard.readText());
      expect(selfAddress).toMatch(/^0x[\da-fA-F]{40}$/);
      await wallet.getByRole('button', { name: 'Transfer Assets', exact: true }).click();
      const transfer = page.getByRole('dialog', { name: 'Transfer Assets', exact: true });
      await expect(transfer).toBeVisible();
      await transfer.getByRole('textbox', { name: 'Destination Address', exact: true }).fill(selfAddress);
      await transfer.getByRole('button', { name: /Lands selected/ }).click({ timeout: 60_000 });
      const land = page.getByRole('menuitemcheckbox').first();
      const landText = await land.innerText();
      selectedLandId = /#(\d+)/.exec(landText)?.[1] ?? '';
      expect(selectedLandId, 'The real wallet needs at least one visible owned land for this journey').toMatch(/^\d+$/);
      await land.click();
      await page.keyboard.press('Escape');
      await expect(transfer.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled();
      await transfer.getByRole('button', { name: 'Continue', exact: true }).click();
      const confirmation = page.getByRole('dialog', { name: 'Confirm Transfer', exact: true });
      await expect(confirmation).toBeVisible();
      const review = confirmation.getByRole('region', { name: 'Transfer review', exact: true });
      await expect(review).toContainText(selfAddress);
      await expect(review).toContainText(`Lands (1): #${selectedLandId}`);
      const reviewBefore = await review.innerText();
      await expect(confirmation.getByRole('checkbox')).not.toBeChecked();
      await expect(confirmation.getByRole('button', { name: 'Confirm & Send', exact: true })).toBeDisabled();
      await screenshot(page, testInfo, 'transfer-review-before');
      await page.keyboard.press('Escape');
      await expect(confirmation).toBeHidden();
      const reopenedWallet = await openWallet(page);
      await reopenedWallet.getByRole('button', { name: 'Transfer Assets', exact: true }).click();
      await expect(confirmation).toBeVisible();
      await expect(review).toHaveText(reviewBefore, { useInnerText: true });
      await expect(confirmation.getByRole('checkbox')).not.toBeChecked();
      await expect(confirmation.getByRole('button', { name: 'Confirm & Send', exact: true })).toBeDisabled();
      await screenshot(page, testInfo, 'transfer-review-reopened');
      await confirmation.getByRole('button', { name: 'Back', exact: true }).click();
      await expect(transfer).toBeVisible();
      await expect(transfer.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
      await expect(transfer.getByRole('button', { name: /Lands selected 0 selected/ })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(transfer).toBeHidden();
      completedSteps.push(`prepared self-transfer of land #${selectedLandId}; identical review after Escape/reopen; cancelled with Back`);
    });

    await test.step('Disconnect and reconnect through the real app', async () => {
      const wallet = await openWallet(page);
      await wallet.getByRole('button', { name: 'Disconnect Wallet', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Local Test Wallet', exact: true })).toBeVisible({ timeout: 60_000 });
      await expect(page.getByRole('button', { name: 'Open wallet profile', exact: true })).toHaveCount(0);
      await screenshot(page, testInfo, 'disconnected');
      await page.getByRole('button', { name: 'Local Test Wallet', exact: true }).click();
      await expect(page.locator('[data-connected=true]')).toBeVisible({ timeout: 60_000 });
      await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
      const reconnectedWallet = await openWallet(page);
      await reconnectedWallet.getByRole('button', { name: 'Copy wallet address', exact: true }).click();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(selfAddress);
      await expectSignedSession(page, selfAddress);
      await screenshot(page, testInfo, 'reconnected-wallet');
      await reconnectedWallet.getByRole('button', { name: 'Disconnect Wallet', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Local Test Wallet', exact: true })).toBeVisible();
      completedSteps.push('disconnected, reconnected same wallet, and disconnected cleanly');
    });

    expect(pageErrors, 'No uncaught browser application errors').toEqual([]);
    expect(submittedMethods, 'The journey must never submit a transaction').toEqual([]);
  } finally {
    const publicResultsPath = testInfo.outputPath('public-journey-results.json');
    await writeFile(publicResultsPath, JSON.stringify({ project: testInfo.project.name, completedSteps, selfAddress, selectedLandId, pageErrors, consoleErrors: [...new Set(consoleErrors)], failedApiRequests, submittedMethods }, null, 2));
    await testInfo.attach('public-journey-results', {
      path: publicResultsPath,
      contentType: 'application/json',
    });
  }
});
