import { expect, test, type Page } from '@playwright/test';
import type { CafaiMockWindow } from '../mock/browser.ts';
import { TID } from '../src/ui/testIds.ts';
import { openApp, recordRequests, saveApiKey, sendChat, type SeenRequest } from './helpers.ts';

/**
 * v1 starts from the dose in Decaid (D57): the profile author's ratio times
 * the dose CafAI reads when the template is picked, so a dose changed after
 * the bag opened is the one used. Blooming Espresso brews at 1:2.8, so the
 * mock's 18 g would stop at 50 g; set to 16 g, v1 stops at 45 g.
 */

/** The workflow numbers and title in the mock Decaid. */
async function workflowNumbers(page: Page) {
  return page.evaluate(() => {
    const workflow = (window as CafaiMockWindow).__CAFAI_MOCK__?.state.getWorkflow();
    return {
      title: workflow?.profile.title ?? null,
      targetWeight: workflow?.profile.target_weight ?? null,
      targetYield: workflow?.context?.targetYield ?? null,
      targetDoseWeight: workflow?.context?.targetDoseWeight ?? null,
    };
  });
}

/** The template-picked results the coach was sent (ENGINE_PROTOCOL rule 2), oldest first. */
function pickedResults(seen: SeenRequest[]): Array<Record<string, unknown>> {
  const results: Array<Record<string, unknown>> = [];
  for (const request of seen) {
    if (new URL(request.url).hostname !== 'api.anthropic.com' || !request.body) continue;
    const body = JSON.parse(request.body) as { messages?: Array<{ content?: unknown }> };
    for (const message of body.messages ?? []) {
      if (!Array.isArray(message.content)) continue;
      for (const block of message.content as Array<Record<string, unknown>>) {
        if (block.type !== 'tool_result' || typeof block.content !== 'string' || !block.content.includes('"picked"')) continue;
        results.push(JSON.parse(block.content) as Record<string, unknown>);
      }
    }
  }
  return results;
}

test('v1 stops at the author ratio times the dose Decaid has when the template is picked', async ({ page }) => {
  const seen = recordRequests(page);
  await openApp(page);
  await saveApiKey(page);
  await page.getByTestId(TID.navCoach).click();
  await page.getByTestId(TID.newBag).click();
  await sendChat(page, 'Kiambu AA, light roast, washed');
  const blooming = page.getByTestId(TID.templatePick('blooming-espresso'));
  await expect(blooming).toBeVisible();

  // The bag opened with the mock's 18 g; the dose changes in Decaid before the pick.
  await page.evaluate(() => {
    (window as CafaiMockWindow).__CAFAI_MOCK__?.state.updateWorkflow({ context: { targetDoseWeight: 16 } });
  });
  await blooming.click();

  await expect(page.getByText('Kiambu AA v1 stops at 45 g: 2.8 x the 16.0 g dose in Decaid.')).toBeVisible();
  await expect(page.getByText('Loaded Kiambu AA v1 on the machine.')).toBeVisible();
  expect(await workflowNumbers(page)).toEqual({ title: 'Kiambu AA v1', targetWeight: 45, targetYield: 45, targetDoseWeight: 16 });

  // The coach is told too.
  await expect.poll(() => pickedResults(seen).at(-1) ?? null, { timeout: 15_000 }).toMatchObject({
    picked: 'blooming-espresso',
    version: 1,
    title: 'Kiambu AA v1',
    yieldG: 45,
    doseG: 16,
    uploaded: true,
    onMachine: true,
  });
});
