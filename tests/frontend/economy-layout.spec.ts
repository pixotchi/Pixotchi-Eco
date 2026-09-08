import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }, testInfo) => {
  await page.goto('/qa/economy-layout');
  await page.getByRole('textbox', { name: 'Sell', exact: true }).waitFor();
  await page.evaluate(dark => {
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(dark ? 'dark' : 'light');
  }, testInfo.project.name.includes('dark'));
});

test('amount cards fit small screens and long values remain editable with visible keyboard focus', async ({ page }) => {
  const card = page.getByTestId('ockSwapAmountInput_Container').first();
  const output = page.getByTestId('ockSwapAmountInput_Container').nth(1);
  const colors = await card.evaluate(element => {
    const resolveColor = (token: string) => {
      const probe = document.createElement('span');
      probe.style.color = `hsl(var(${token}))`;
      element.appendChild(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    };
    return { edge: resolveColor('--edge-panel'), primary: resolveColor('--primary') };
  });
  await expect(card).toHaveCSS('border-top-width', '1px');
  await expect(card).toHaveCSS('border-top-color', colors.edge);
  await expect(output).toHaveCSS('border-top-width', '0px');
  if ((page.viewportSize()?.width ?? 0) <= 390) expect((await card.boundingBox())!.height).toBeLessThan(135);
  const input = page.getByRole('textbox', { name: 'Sell', exact: true });
  await input.fill('12345678901234567890.123456789012345678');
  await expect(input).toHaveValue('12345678901234567890.123456789012345678');
  await input.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(input).toBeFocused();
  await expect(card).toHaveCSS('border-top-width', '1px');
  await expect(card).toHaveCSS('border-top-color', colors.primary);
  await expect(output).toHaveCSS('border-top-width', '0px');
  const inputStyle = await input.evaluate(element => ({ fontSize: parseFloat(getComputedStyle(element).fontSize), outline: parseFloat(getComputedStyle(element).outlineWidth) }));
  expect(inputStyle.fontSize).toBeGreaterThanOrEqual(16);
  expect(inputStyle.outline).toBeGreaterThanOrEqual(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const name of ['ETH', 'Max', 'SEED', 'Swap']) {
    const button = page.getByRole('button', { name, exact: true });
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
});

test('confirmed explorer reference survives reload and disappears immediately for another wallet', async ({ page }) => {
  await page.getByRole('button', { name: 'Record fixture receipt' }).click();
  const receipt = page.getByRole('link', { name: 'Last swap confirmed — view transaction' });
  await expect(receipt).toHaveAttribute('href', `https://basescan.org/tx/0x${'a'.repeat(64)}`);
  await page.reload();
  await expect(receipt).toBeVisible();
  await page.getByRole('button', { name: 'Show recovery guidance' }).click();
  const notice = page.getByTestId('ockSwapMessage_Message');
  await expect(notice).toContainText('No additional payment is needed.');
  expect(await notice.evaluate(element => element.scrollHeight <= element.clientHeight)).toBe(true);
  await page.getByRole('button', { name: 'Change fixture wallet' }).click();
  await expect(receipt).toHaveCount(0);
});
