import { expect, test, type Page } from '@playwright/test';
import { TID } from '../src/ui/testIds.ts';
import { composerField, goTo, openApp, pullShot, saveApiKey, sendChat } from './helpers.ts';

/**
 * Taste words and Need help? (D127), on the tablets and the phones. The coach
 * never says what a shot should taste like, so after a shot, while "How did it
 * taste?" is open, two prompts join Stats above the composer: Taste words
 * opens neutral descriptors one group of what to notice at a time, and a
 * tapped word goes into the message being written; Need help? teaches how to
 * taste. Nothing is sent until Send, and then the words are the shot's taste.
 *
 * mockSpeed 10 plays the scripted shot (about 30 s of data) in about 3 s.
 */
const SPEED = 10;

/** A bag on Blooming Espresso v1, one shot pulled, its taste question open. */
async function toTasteQuestion(page: Page): Promise<void> {
  await openApp(page, '#/', SPEED);
  await saveApiKey(page);
  await goTo(page, 'coach');
  await page.getByTestId(TID.newBag).click();
  await expect(page.getByTestId(TID.chat)).toContainText('origin');
  await sendChat(page, 'Kiambu AA, light roast, washed');
  await page.getByTestId(TID.templatePick('blooming-espresso')).click();
  await expect(page.getByText('Loaded Kiambu AA v1 on the machine.')).toBeVisible();
  // Nothing to describe yet: no taste words before a shot.
  await expect(page.getByTestId(TID.tastePrompt)).toHaveCount(0);
  await pullShot(page);
  await expect(page.getByTestId(TID.shotCard)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId(TID.optionChip('Sour / sharp'))).toBeVisible({ timeout: 60_000 });
}

test('after a shot, Need help? teaches how to taste and tapped words fill the message, sent only with Send', async ({ page }) => {
  await toTasteQuestion(page);
  const thread = page.getByRole('log', { name: 'Conversation with the coach' });
  const prompt = page.getByTestId(TID.tastePrompt);
  await expect(prompt).toBeVisible();
  await expect(prompt).toHaveAttribute('aria-expanded', 'false');

  // Need help?: how to taste, never what this coffee should taste like; the whole guide reaches Got it.
  await page.getByTestId(TID.tasteHelp).click();
  const guide = page.getByRole('dialog', { name: 'How to taste' });
  await expect(guide).toBeVisible();
  await expect(guide).toContainText('Acidity: does it make your mouth water?');
  await expect(guide).toContainText('Body: how heavy does it feel on your tongue?');
  await expect(guide).toContainText('There are no wrong answers. Say what you notice, in any words.');
  await expect(guide).toContainText('Your last shot is the best guide');
  const gotIt = guide.getByRole('button', { name: 'Got it' });
  await expect(gotIt).toBeInViewport({ ratio: 1 });
  await gotIt.click();
  await expect(guide).toHaveCount(0);

  // Taste words: one group of what to notice at a time, its question, its words.
  await prompt.click();
  await expect(prompt).toHaveAttribute('aria-expanded', 'true');
  const words = page.getByTestId(TID.tasteWords);
  await expect(words).toContainText('Does it make your mouth water?');
  await words.getByTestId(TID.tasteWord('sharp')).click();
  await words.getByTestId(TID.tasteGroup('body')).click();
  await expect(words).toContainText('How heavy does it feel on your tongue?');
  const thin = words.getByTestId(TID.tasteWord('thin'));
  await thin.click();
  await expect(thin).toHaveAttribute('aria-pressed', 'true');
  expect((await thin.boundingBox())?.height ?? 0, 'a word is a full touch target').toBeGreaterThanOrEqual(47.5);

  // The words are in the message being written, the composer whole on screen, and nothing was sent.
  const composer = await composerField(page);
  await expect(composer).toHaveValue('sharp, thin');
  await expect(page.getByTestId(TID.composerSend)).toBeInViewport({ ratio: 1 });
  await expect(thread).not.toContainText('sharp, thin');
  await expect(page.getByTestId(TID.optionChip('Sour / sharp'))).toBeEnabled();

  // Send: the barista's words go to the coach as the shot's taste, and the words give way.
  await page.getByTestId(TID.composerSend).click();
  await expect(thread).toContainText('sharp, thin');
  await expect(prompt).toHaveCount(0);
  const change = page.getByTestId(TID.diffCard);
  await expect(change).toBeVisible();
  // What the change does at the machine, never a taste to expect.
  await expect(change.getByTestId(TID.diffReason)).toContainText('What it changes:');
  await expect(change).not.toContainText('Expect:');
});
