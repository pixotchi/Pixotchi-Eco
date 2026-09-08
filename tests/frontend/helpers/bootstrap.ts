import { expect, type Page, type TestInfo } from '@playwright/test';

/** Give cold dev/WebKit hydration its own bounded budget, retaining the normal
 * action/assertion budget and rejecting React boot errors instead of hiding them. */
export async function openFrontendFixture(page: Page, testInfo: TestInfo, suite: string) {
  return openQaFixture(page, testInfo, `/qa/frontend?suite=${suite}`);
}

export async function openQaFixture(page: Page, testInfo: TestInfo, path: string) {
  const actionBudget = testInfo.timeout;
  testInfo.setTimeout(actionBudget + 40_000);
  const started = Date.now();
  const bootErrors: string[] = [];
  const pageError = (error: Error) => bootErrors.push(error.message);
  page.on('pageerror', pageError);
  await page.goto(path, { timeout: 20_000 });
  await expect(page.locator('[data-fixtures-ready=true]')).toBeVisible({ timeout: 20_000 });
  page.off('pageerror', pageError);
  expect(bootErrors, 'Fixture hydration must complete without React/runtime errors').toEqual([]);
  const elapsed = Date.now() - started;
  testInfo.setTimeout(actionBudget + elapsed);
  testInfo.annotations.push({ type: 'fixture-boot-ms', description: String(elapsed) });
}
