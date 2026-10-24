import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { TID } from '../src/ui/testIds.ts';
import { goTo, openApp, saveApiKey } from './helpers.ts';

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
