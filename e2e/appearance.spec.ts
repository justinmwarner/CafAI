import { expect, test, type Page } from '@playwright/test';
import { TID } from '../src/ui/testIds.ts';
import { goTo, isPhone, openApp } from './helpers.ts';

/**
 * Settings > Display > Appearance (D80, D82), in every layout: a mode and a
 * tint recolour the whole app at once, every screen, and stay after a reload
 * (CafAI's own storage keeps the setting; nothing here needs the mock
 * Decaid's store). The custom hue slider works from the keyboard too.
 */

/** Settings > Display, the way each layout gets there: its own address on a tablet, the Settings tab and Display's row on a phone. */
async function openSettings(page: Page): Promise<void> {
  if (isPhone(page)) {
    await openApp(page);
    await goTo(page, 'settings', 'display');
  } else {
    await openApp(page, '#/settings/display');
  }
  await expect(page.getByRole('region', { name: 'Appearance' })).toBeVisible();
}

const background = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

/** WCAG relative luminance of a computed `rgb(r, g, b)` colour, 0 (black) to 1 (white). */
function luminance(rgb: string): number {
  const match = /^rgba?\((\d+), (\d+), (\d+)/.exec(rgb);
  if (!match) throw new Error(`Not an rgb() colour: ${rgb}`);
  const [r, g, b] = match.slice(1, 4).map((channel) => {
    const c = Number(channel) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

test('Light and Matcha recolour every screen at once, and stay after a reload', async ({ page }) => {
  await openSettings(page);
  const dark = await background(page);
  // The default look: dark Crema.
  expect(luminance(dark)).toBeLessThan(0.1);
  await expect(page.getByTestId(TID.appearanceMode('dark'))).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId(TID.tintSwatch('crema'))).toHaveAttribute('aria-checked', 'true');

  await page.getByTestId(TID.appearanceMode('light')).click();
  await expect(page.getByTestId(TID.appearanceMode('light'))).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => background(page), { message: 'Light changes the background' }).not.toBe(dark);
  const lightCrema = await background(page);
  expect(luminance(lightCrema)).toBeGreaterThan(0.7);

  await page.getByTestId(TID.tintSwatch('matcha')).click();
  await expect(page.getByTestId(TID.tintSwatch('matcha'))).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId(TID.tintSwatch('crema'))).toHaveAttribute('aria-checked', 'false');
  await expect.poll(() => background(page), { message: 'Matcha tints the background' }).not.toBe(lightCrema);
  const lightMatcha = await background(page);
  expect(luminance(lightMatcha)).toBeGreaterThan(0.7);

  // Another screen has the same look.
  await goTo(page, 'coach');
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole('heading', { name: 'Add your Anthropic API key to start coaching' })).toBeVisible();
  expect(await background(page)).toBe(lightMatcha);

  // And so does the next start.
  await page.reload();
  await expect(page.getByTestId(TID.appReady)).toBeVisible();
  await expect.poll(() => background(page), { message: 'the look after a reload' }).toBe(lightMatcha);
  await goTo(page, 'settings', 'display');
  await expect(page.getByTestId(TID.appearanceMode('light'))).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId(TID.tintSwatch('matcha'))).toHaveAttribute('aria-checked', 'true');
  expect(await background(page)).toBe(lightMatcha);
});

test('the custom hue slider, moved with the keyboard, checks Custom and is kept', async ({ page }) => {
  await openSettings(page);
  const hue = page.getByTestId(TID.tintHue);
  const custom = page.getByTestId(TID.tintSwatch('custom'));
  await expect(custom).toHaveAttribute('aria-checked', 'false');
  // Crema's own hue, where the slider starts.
  await expect(hue).toHaveValue('68');

  await hue.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(hue).toHaveValue('70');
  await expect(hue).toHaveAttribute('aria-valuetext', '70 degrees');
  await expect(custom).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId(TID.tintSwatch('crema'))).toHaveAttribute('aria-checked', 'false');

  // The reload opens Settings > Display again: the address keeps the route.
  await page.reload();
  await expect(page.getByTestId(TID.appReady)).toBeVisible();
  await expect(custom).toHaveAttribute('aria-checked', 'true');
  await expect(hue).toHaveValue('70');
});
