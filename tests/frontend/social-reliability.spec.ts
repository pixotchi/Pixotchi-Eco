import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/qa/social-reliability');
  await expect(page.locator('[data-ai-ready=true]')).toBeVisible({ timeout: 30_000 });
});

for (const elapsed of [1_000, 29_000]) {
  test(`Activity fetches a new wallet after ${elapsed / 1000}s and rejects late old data`, async ({ page }) => {
    await page.clock.install();
    const region = page.getByRole('region', { name: 'Activity reliability' });
    await page.clock.fastForward(elapsed);
    await region.getByRole('button', { name: 'Connect A' }).click();
    await expect(region.getByLabel('Activity reads')).toHaveText('1');
    await region.getByRole('button', { name: 'Connect B' }).click();
    await expect(region.getByLabel('Activity reads')).toHaveText('2');
    await region.getByRole('button', { name: 'Resolve latest activity' }).click();
    await expect(region.getByLabel('My activity')).toHaveText('Wallet B activity');
    await region.getByRole('button', { name: 'Resolve first activity' }).click();
    await expect(region.getByLabel('My activity')).toHaveText('Wallet B activity');
  });
}

test('Verify Claim ignores a slow already-claimed response from the previous wallet', async ({ page }) => {
  const region = page.getByRole('region', { name: 'Claim reliability' });
  await region.getByRole('button', { name: 'Switch claim wallet' }).click();
  await region.getByRole('button', { name: 'B eligible' }).click();
  await expect(region.getByRole('button', { name: 'Verify & Claim', exact: true })).toBeEnabled();
  await region.getByRole('button', { name: 'A already claimed' }).click();
  await expect(region.getByRole('button', { name: 'Verify & Claim', exact: true })).toBeEnabled();
});

test('Verify Claim does not submit after the signer changes wallet', async ({ page }) => {
  const region = page.getByRole('region', { name: 'Claim reliability' });
  await region.getByRole('button', { name: 'A eligible' }).click();
  await region.getByRole('button', { name: 'Verify & Claim', exact: true }).click();
  await region.getByRole('button', { name: 'Switch claim wallet' }).click();
  await region.getByRole('button', { name: 'Resolve signature' }).click();
  await region.getByRole('button', { name: 'B eligible' }).click();
  await expect(region.getByRole('button', { name: 'Verify & Claim', exact: true })).toBeEnabled();
  await expect(region.getByLabel('Submitted claims')).toHaveText('0');
});

test('a submitted old-wallet claim cannot celebrate under the new wallet', async ({ page }) => {
  const region = page.getByRole('region', { name: 'Claim reliability' });
  await region.getByRole('button', { name: 'A eligible' }).click();
  await region.getByRole('button', { name: 'Verify & Claim', exact: true }).click();
  await region.getByRole('button', { name: 'Resolve signature' }).click();
  await expect(region.getByLabel('Submitted claims')).toHaveText('1');
  await region.getByRole('button', { name: 'Switch claim wallet' }).click();
  await region.getByRole('button', { name: 'B eligible' }).click();
  await region.getByRole('button', { name: 'Resolve submitted claim' }).click();
  await expect(region.getByLabel('Claim successes')).toHaveText('0');
  await expect(region.getByRole('button', { name: 'Verify & Claim', exact: true })).toBeEnabled();
});

for (const replaceHistory of ['none', 'after', 'during'] as const) {
test(`SDK transport failure preserves draft and retries with history replacement ${replaceHistory}`, async ({ page }) => {
  const region = page.getByRole('region', { name: 'AI reliability' });
  let requests = 0;
  let failFirstRequest: (() => Promise<void>) | undefined;
  await page.route('**/api/chat/ai/send', async route => {
    requests += 1;
    if (requests === 1) {
      const fail = () => route.fulfill({ status: 401, contentType: 'text/plain', body: 'Authentication required' });
      if (replaceHistory !== 'during') return fail();
      failFirstRequest = fail;
      return;
    }
    const chunks = [
      { type: 'start', messageId: 'fixture-answer' },
      { type: 'text-start', id: 'text-1' },
      { type: 'text-delta', id: 'text-1', delta: 'A successful answer' },
      { type: 'text-end', id: 'text-1' },
      { type: 'finish', finishReason: 'stop' },
    ];
    await route.fulfill({ status: 200, contentType: 'text/event-stream', headers: { 'x-vercel-ai-ui-message-stream': 'v1' }, body: chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n' });
  });
  await region.getByRole('textbox').fill('Keep this question');
  await region.getByRole('button', { name: 'Send question to Neural Seed' }).click();
  if (replaceHistory === 'during') {
    await expect.poll(() => Boolean(failFirstRequest)).toBe(true);
    await region.getByRole('button', { name: 'Replace AI history' }).click();
    await failFirstRequest!();
  }
  await expect(region.getByRole('textbox')).toHaveValue('Keep this question');
  await expect(region.getByLabel('AI error')).toContainText('session expired');
  if (replaceHistory !== 'during') await expect(region.getByRole('article', { name: 'Message from You' }).getByRole('status')).toContainText('Response failed.');
  if (replaceHistory === 'after') await region.getByRole('button', { name: 'Replace AI history' }).click();
  await region.getByRole('button', { name: 'Send question to Neural Seed' }).click();
  await expect(region.getByRole('textbox')).toHaveValue('');
  await expect(region.getByRole('article', { name: 'Message from You' })).toHaveCount(1);
  await expect(region.getByRole('article', { name: 'Message from You' }).getByRole('status')).toHaveCount(0);
});

}
