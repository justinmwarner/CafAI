import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { TID } from '../src/ui/testIds.ts';
import { goTo, openApp, saveApiKey, sendChat } from './helpers.ts';

/**
 * Export (D244): History's button and Settings > Data and privacy > Your
 * data share one export (src/ui/data/ExportData.tsx). In a browser it
 * downloads a dated file and shows the same text in "Your CafAI data" for
 * copying; inside Decaid, where a download usually goes nowhere, it shows the
 * text at once. Either way the API key is never in it.
 */

/** A made-up key, built at run time, so no trace of it can be a real one. */
const KEY = ['sk', 'ant', 'api03', `exportE2e${Date.now().toString(36)}`, 'Zz9Yy8Xx7Ww6Vv5Uu4AA'].join('-');

test('History exports a dated file, the same text in its dialog, never the API key', async ({ page }) => {
  await openApp(page);
  await saveApiKey(page, KEY);
  await goTo(page, 'history');

  const download = page.waitForEvent('download');
  await page.getByTestId(TID.exportData).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^cafai-export-\d{4}-\d{2}-\d{2}\.json$/);

  const dialog = page.getByRole('dialog', { name: 'Your CafAI data' });
  await expect(dialog).toContainText(`Saved as ${file.suggestedFilename()}.`);
  await expect(dialog).toContainText('It holds your bags, versions and shots, never your API key.');
  const text = await dialog.getByRole('textbox', { name: 'Exported data' }).inputValue();
  expect(JSON.parse(text)).toMatchObject({ format: 'cafai-export' });
  expect(readFileSync(await file.path(), 'utf8')).toBe(text);
  expect(text).not.toContain(KEY);
  expect(text).not.toContain('Zz9Yy8Xx7Ww6Vv5Uu4AA');

  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId(TID.exportData)).toBeEnabled();
});

test('inside Decaid, History shows the export to copy instead of downloading it', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, '__DECENT_HOST__', {
      value: Object.freeze({ app: 'decent.app', platform: 'android', version: '0.9.0', build: '3000', commit: 'aab5f938' }),
      configurable: false,
      writable: false,
      enumerable: false,
    });
  });
  const downloads: string[] = [];
  page.on('download', (file) => downloads.push(file.suggestedFilename()));
  await openApp(page, '#/history');

  await page.getByTestId(TID.exportData).click();
  const dialog = page.getByRole('dialog', { name: 'Your CafAI data' });
  await expect(dialog).toContainText('Downloads may not work inside Decaid. Copy the text below and keep it somewhere safe.');
  expect(JSON.parse(await dialog.getByRole('textbox', { name: 'Exported data' }).inputValue())).toMatchObject({ format: 'cafai-export' });
  await expect(dialog.getByRole('button', { name: 'Copy' })).toBeVisible();
  expect(downloads).toEqual([]);
});

/** Export from `button`: the file it downloads and the text its dialog shows, the same, then the dialog closed. */
async function exportFrom(page: Page, button: Locator): Promise<{ name: string; text: string }> {
  const download = page.waitForEvent('download');
  await button.click();
  const file = await download;
  const dialog = page.getByRole('dialog', { name: 'Your CafAI data' });
  await expect(dialog).toContainText(`Saved as ${file.suggestedFilename()}.`);
  await expect(dialog).toContainText('It holds your bags, versions and shots, never your API key.');
  const text = await dialog.getByRole('textbox', { name: 'Exported data' }).inputValue();
  expect(readFileSync(await file.path(), 'utf8')).toBe(text);
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();
  return { name: file.suggestedFilename(), text };
}

/** An export without the moment it was made, which is all two exports of the same data differ by. */
function withoutTime(text: string): Record<string, unknown> {
  const { exportedAt, ...rest } = JSON.parse(text) as Record<string, unknown>;
  expect(typeof exportedAt).toBe('string');
  return rest;
}

test('Settings > Data and privacy > Your data exports the same file as History, never the API key', async ({ page }) => {
  await openApp(page);
  await saveApiKey(page, KEY);
  // A bag described to the coach, so the file holds more than the settings.
  await goTo(page, 'coach');
  await page.getByTestId(TID.newBag).click();
  await sendChat(page, 'Kiambu AA, light roast, washed');
  await expect(page.getByTestId(TID.templatePick('blooming-espresso'))).toBeVisible();
  await expect(page.getByTestId(TID.chat), 'the coach is done').not.toHaveAttribute('data-busy');

  await goTo(page, 'settings', 'data');
  const card = page.getByRole('region', { name: 'Your data' });
  await expect(card).toContainText('Your bags, versions and shots, as a file to keep or move to another device. Never your API key.');
  const fromSettings = await exportFrom(page, card.getByTestId(TID.settingsExport));
  expect(fromSettings.name).toMatch(/^cafai-export-\d{4}-\d{2}-\d{2}\.json$/);
  expect(JSON.parse(fromSettings.text)).toMatchObject({ format: 'cafai-export' });
  expect(fromSettings.text).toContain('Kiambu AA');
  expect(fromSettings.text).not.toContain(KEY);
  expect(fromSettings.text).not.toContain('Zz9Yy8Xx7Ww6Vv5Uu4AA');
  await expect(card.getByTestId(TID.settingsExport)).toBeEnabled();
  await expect(card.getByTestId(TID.settingsExportSaid)).toHaveCount(0);

  // History's Export: the same file, but for the moment it was made.
  await goTo(page, 'history');
  const fromHistory = await exportFrom(page, page.getByTestId(TID.exportData));
  expect(fromHistory.name).toBe(fromSettings.name);
  expect(withoutTime(fromHistory.text)).toEqual(withoutTime(fromSettings.text));
});

test("inside Decaid, Settings' Export shows the text to copy, as History's does", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, '__DECENT_HOST__', {
      value: Object.freeze({ app: 'decent.app', platform: 'android', version: '0.9.0', build: '3000', commit: 'aab5f938' }),
      configurable: false,
      writable: false,
      enumerable: false,
    });
  });
  const downloads: string[] = [];
  page.on('download', (file) => downloads.push(file.suggestedFilename()));
  await openApp(page, '#/settings/data');

  await page.getByRole('region', { name: 'Your data' }).getByTestId(TID.settingsExport).click();
  const dialog = page.getByRole('dialog', { name: 'Your CafAI data' });
  await expect(dialog).toContainText('Downloads may not work inside Decaid. Copy the text below and keep it somewhere safe.');
  expect(JSON.parse(await dialog.getByRole('textbox', { name: 'Exported data' }).inputValue())).toMatchObject({ format: 'cafai-export' });
  await expect(dialog.getByRole('button', { name: 'Copy' })).toBeVisible();
  expect(downloads).toEqual([]);
});
