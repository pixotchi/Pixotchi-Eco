import { expect, test, type Locator } from '@playwright/test';

async function expectVisibleFocus(control: Locator) {
  await expect(control).toBeFocused();
  const appearance = await control.evaluate(element => {
    const style = getComputedStyle(element);
    const appearance = {
      visible: element.matches(':focus-visible'),
      shadow: style.boxShadow,
      ring: style.getPropertyValue('--tw-ring-shadow').trim(),
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
      outlineColor: style.outlineColor,
      withoutRing: '',
    };
    // A populated ring variable alone is insufficient: an overriding box-shadow
    // can omit it. Compare the actual painted shadow with that contribution off.
    const previousRing = element.style.getPropertyValue('--tw-ring-shadow');
    const previousPriority = element.style.getPropertyPriority('--tw-ring-shadow');
    element.style.setProperty('--tw-ring-shadow', '0 0 #0000', 'important');
    appearance.withoutRing = getComputedStyle(element).boxShadow;
    if (previousRing) element.style.setProperty('--tw-ring-shadow', previousRing, previousPriority);
    else element.style.removeProperty('--tw-ring-shadow');
    return appearance;
  });
  expect(appearance.visible).toBe(true);
  const outline = !['none', 'hidden'].includes(appearance.outlineStyle)
    && appearance.outlineWidth >= 2 && appearance.outlineColor !== 'rgba(0, 0, 0, 0)';
  const ring = appearance.shadow !== 'none' && appearance.ring !== ''
    && appearance.ring !== '0 0 #0000' && appearance.shadow !== appearance.withoutRing;
  expect(outline || ring, JSON.stringify(appearance)).toBe(true);
}

for (const theme of ['light', 'dark', 'green', 'yellow', 'red', 'pink', 'blue', 'violet']) {
  test(`keyboard focus survives normal and performance modes in ${theme}`, async ({ page }, testInfo) => {
    test.skip(!['390-light', '1440-dark', 'webkit-390-light'].includes(testInfo.project.name), 'Full palette on phone/desktop Chromium and phone WebKit.');
    await page.goto('/qa/focus');
    await expect(page.locator('[data-focus-ready=true]')).toBeVisible();
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    for (const performance of [false, true]) {
      await page.evaluate(({ theme, performance }) => {
        document.documentElement.classList.remove('light', 'dark', 'green', 'yellow', 'red', 'pink', 'blue', 'violet', 'performance-mode');
        document.documentElement.classList.add(theme);
        if (performance) document.documentElement.classList.add('performance-mode');
        (document.activeElement as HTMLElement | null)?.blur();
        const first = document.querySelector('main button') as HTMLElement;
        first.focus();
      }, { theme, performance });
      // Shift-Tab and Tab enter the sequence through actual keyboard navigation.
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      for (const name of ['Primary action', 'Outline action', 'Refresh balances', 'Selected tab', 'Unselected tab', 'Profile Follow']) {
        const control = page.getByRole('button', { name, exact: true });
        await expectVisibleFocus(control);
        if (performance) expect(await control.evaluate(el => getComputedStyle(el).getPropertyValue('--tw-shadow').trim())).toBe('0 0 #0000');
        await page.keyboard.press('Tab');
      }
      await expectVisibleFocus(page.getByRole('radio', { name: 'Plants', exact: true }));
      await page.keyboard.press('ArrowRight');
      await expectVisibleFocus(page.getByRole('radio', { name: 'Lands', exact: true }));
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('Tab');
      await expectVisibleFocus(page.getByRole('textbox', { name: 'Stake amount (SEED)' }));
      await page.keyboard.press('Tab');
      await expectVisibleFocus(page.getByRole('button', { name: 'Open focus dialog' }));
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', { name: 'Focus dialog' });
      await expect(dialog).toBeVisible();
      const close = dialog.getByRole('button', { name: 'Close dialog' });
      await close.focus();
      await expectVisibleFocus(close);
      await page.keyboard.press('Escape');
      await expectVisibleFocus(page.getByRole('button', { name: 'Open focus dialog' }));
    }
  });
}
