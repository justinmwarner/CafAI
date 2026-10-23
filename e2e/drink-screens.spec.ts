import { expect, test, type Locator, type Page } from '@playwright/test';
import { TID } from '../src/ui/testIds.ts';
import { machineRow, openApp } from './helpers.ts';

/**
 * Settings > Drink screens (D217, D222), on the tablets and the
 * phones: a scene picked there is the one the drink's next run draws, kept
 * after a reload, and a drink whose Go back by itself is off stays on its
 * view once done. The mock runs each drink compressed 25 times
 * (drink-views.spec.ts), so a run is over in a couple of seconds.
 */

const view = (page: Page) => page.getByTestId(TID.drinkView);
const hash = (page: Page) => new URL(page.url()).hash;

/** Settings, scrolled to the section. */
async function openSection(page: Page): Promise<Locator> {
  await openApp(page, '#/settings');
  const section = page.getByTestId(TID.drinkScreens);
  await section.scrollIntoViewIfNeeded();
  return section;
}

type Box = NonNullable<Awaited<ReturnType<Locator['boundingBox']>>>;

async function box(locator: Locator): Promise<Box> {
  const found = await locator.boundingBox();
  if (found === null) throw new Error('The element has no box: it is not on the page.');
  return found;
}

test('a scene picked in Settings is the one the next steam draws, and it stays picked', async ({ page }) => {
  const section = await openSection(page);
  const steam = section.getByTestId(TID.drinkScene('steam'));
  await expect(steam).toHaveValue('spray');
  await steam.selectOption({ label: 'Whirlpool' });
  await expect(steam).toHaveValue('whirlpool');

  await machineRow(page).getByTestId(TID.steamButton).click();
  await expect(view(page)).toHaveAttribute('data-drink', 'steam');
  await expect(view(page).getByTestId(TID.drinkDial)).toHaveAttribute('data-scene', 'whirlpool');
  await expect(view(page).getByTestId(TID.drinkPhase)).toContainText('Done');
  await view(page).getByRole('button', { name: 'Go back to Settings' }).click();
  await expect(page.getByTestId(TID.drinkScene('steam'))).toHaveValue('whirlpool');

  // Kept on this device: the next start has it too.
  await page.reload();
  await expect(page.getByTestId(TID.appReady)).toBeVisible();
  await expect(page.getByTestId(TID.drinkScene('steam'))).toHaveValue('whirlpool');
  await expect(page.getByTestId(TID.drinkScene('flush'))).toHaveValue('shower');
});

test('a drink whose Go back by itself is off stays on its view once done', async ({ page }) => {
  const section = await openSection(page);
  const toggle = section.getByTestId(TID.drinkGoBackSwitch('flush'));
  await expect(toggle).toBeChecked();
  await expect(section.getByRole('spinbutton', { name: 'Flush go back after' })).toHaveValue('10');
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(section.getByRole('spinbutton', { name: 'Flush go back after' })).toHaveCount(0);
  await expect(section.getByText('The screen stays until you tap Go back.')).toBeVisible();

  await machineRow(page).getByTestId(TID.flushButton).click();
  await expect(view(page)).toHaveAttribute('data-drink', 'flush');
  await expect(view(page).getByTestId(TID.drinkPhase)).toContainText('Done');
  // Three seconds on, no countdown has started and the view stays: Go back alone, without its seconds or Stay.
  await page.waitForTimeout(3000);
  await expect(view(page).getByTestId(TID.drinkGoBackSeconds)).toHaveCount(0);
  await expect(view(page).getByTestId(TID.drinkStay)).toHaveCount(0);
  expect(hash(page)).toBe('#/flush');
  await view(page).getByRole('button', { name: 'Go back to Settings' }).click();
  await expect(page.getByTestId(TID.drinkGoBackSwitch('flush'))).not.toBeChecked();
});

test('laid out as the section above: side by side from 600 px, and on a phone upright one row per setting with its control at the end', async ({ page }) => {
  const section = await openSection(page);
  // Flush off, so its line is in the layout too.
  await section.getByTestId(TID.drinkGoBackSwitch('flush')).click();
  await expect(section.getByText('The screen stays until you tap Go back.')).toBeVisible();
  const sideBySide = page.viewportSize()!.width >= 600;
  const headings: Box[] = [];

  for (const [name, kind] of [
    ['Steam', 'steam'],
    ['Hot water', 'hotWater'],
    ['Flush', 'flush'],
  ] as const) {
    const group = section.getByRole('group', { name });
    headings.push(await box(group.getByRole('heading', { name })));
    // The drink's time in the section above, a stepper where its own group lays its controls.
    const above = await box(page.getByTestId(TID.drinkSettings).getByRole('spinbutton', { name: `${name} time` }).locator('..'));
    const animation = await box(group.getByText('Animation', { exact: true }));
    const select = await box(group.getByTestId(TID.drinkScene(kind)));
    const toggleRow = await box(group.locator('label', { has: page.getByTestId(TID.drinkGoBackSwitch(kind)) }));
    // Each setting's label and its control.
    const rows: Array<readonly [string, Box, Box]> = [['Animation', animation, select]];
    if (kind === 'flush') {
      expect((await box(group.getByText('The screen stays until you tap Go back.'))).height, 'the line holds a row').toBeGreaterThanOrEqual(48);
    } else {
      const after = await box(group.getByText('After', { exact: true }));
      rows.push(['After', after, await box(group.getByRole('spinbutton', { name: `${name} go back after` }).locator('..'))]);
    }

    // A thumb's height each, the switch's row taking the tap.
    expect(toggleRow.height, `${name}: the switch's row`).toBeGreaterThanOrEqual(48);
    for (const [what, label, control] of rows) {
      expect(control.height, `${name}: ${what}'s control`).toBeGreaterThanOrEqual(48);
      // As wide as the steppers above, and in line with them.
      expect(Math.abs(control.x - above.x), `${name}: ${what}'s control starts where the stepper above does`).toBeLessThanOrEqual(1);
      expect(Math.abs(control.width - above.width), `${name}: ${what}'s control as wide as the stepper above`).toBeLessThanOrEqual(1);
      if (sideBySide) {
        expect(label.y + label.height, `${name}: ${what} over its control`).toBeLessThanOrEqual(control.y);
      } else {
        const middle = label.y + label.height / 2;
        expect(label.x + label.width, `${name}: ${what} before its control`).toBeLessThanOrEqual(control.x);
        expect(middle, `${name}: ${what} on its control's row`).toBeGreaterThan(control.y);
        expect(middle, `${name}: ${what} on its control's row`).toBeLessThan(control.y + control.height);
      }
    }
  }

  for (const [index, heading] of headings.entries()) {
    if (index === 0) continue;
    const before = headings[index - 1]!;
    if (sideBySide) {
      expect(Math.abs(heading.y - before.y), 'the drinks side by side').toBeLessThanOrEqual(1);
      expect(heading.x, 'in the order of the section above').toBeGreaterThan(before.x);
    } else {
      expect(heading.y, 'the drinks stacked, in the order of the section above').toBeGreaterThan(before.y);
    }
  }
});
