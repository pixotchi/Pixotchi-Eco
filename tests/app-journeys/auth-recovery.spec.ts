import { expect, test, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { expectSignedSession } from './helpers/public-session';

async function openWallet(page: Page) {
  await page.getByRole('button', { name: 'Open wallet profile', exact: true }).click();
  const wallet = page.getByRole('dialog', { name: 'Wallet Profile', exact: true });
  await expect(wallet).toBeVisible();
  return wallet;
}

test('a previously connected wallet stays signed out during recovery hydration and reconnects explicitly', async ({ page }, testInfo) => {
  let pageErrorCount = 0;
  let publicAddress = '';
  const completedSteps: string[] = [];
  page.on('pageerror', () => { pageErrorCount++; });
  try {
    await page.goto('/');
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    await page.getByRole('button', { name: 'Local Test Wallet', exact: true }).click();
    await expect(page.locator('[data-connected=true]')).toBeVisible({ timeout: 60_000 });
    const tutorial = page.getByRole('dialog', { name: /Pixotchi tutorial/ });
    await tutorial.getByRole('button', { name: 'Skip', exact: true }).click();
    await expect(tutorial).toBeHidden();
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    const initialWallet = await openWallet(page);
    await initialWallet.getByRole('button', { name: 'Copy wallet address', exact: true }).click();
    publicAddress = await page.evaluate(() => navigator.clipboard.readText());
    expect(publicAddress).toMatch(/^0x[\da-fA-F]{40}$/);
    await expectSignedSession(page, publicAddress);
    completedSteps.push('connected through Local Test Wallet and copied only its public address');

    // Keep this same browser context and its genuine SDK session. No logout or
    // storage manipulation precedes the fresh signed-out document.
    await page.goto('/?walletSession=signedout&surface=test');
    await expect(page.locator('[data-connected=false]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Local Test Wallet', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Open wallet profile', exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Local Test Wallet', exact: true })).toBeEnabled();
    await expect(page.locator('[data-connected=true]')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('signed-out-recovery.png'), animations: 'disabled' });
    completedSteps.push('existing SDK session stayed signed out on recovery navigation and reload');

    await page.getByRole('button', { name: 'Local Test Wallet', exact: true }).click();
    await expect(page).not.toHaveURL(/walletSession=/);
    await expect(page.locator('[data-connected=true]')).toBeVisible({ timeout: 60_000 });
    await expect(tutorial).toHaveCount(0);
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    const recoveredWallet = await openWallet(page);
    await recoveredWallet.getByRole('button', { name: 'Copy wallet address', exact: true }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(publicAddress);
    await expectSignedSession(page, publicAddress);
    completedSteps.push('explicit sign-in removed the recovery flag and restored the same public owner');
    await recoveredWallet.getByRole('button', { name: 'Disconnect Wallet', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Local Test Wallet', exact: true })).toBeEnabled({ timeout: 60_000 });
    await expect(page.getByRole('button', { name: 'Open wallet profile', exact: true })).toHaveCount(0);
    completedSteps.push('final disconnect completed');
    expect(pageErrorCount).toBe(0);
  } finally {
    const resultPath = testInfo.outputPath('public-auth-recovery-results.json');
    await writeFile(resultPath, JSON.stringify({ project: testInfo.project.name, publicAddress, completedSteps, pageErrorCount }, null, 2));
    await testInfo.attach('public-auth-recovery-results', { path: resultPath, contentType: 'application/json' });
  }
});
