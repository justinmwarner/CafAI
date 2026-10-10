import { expect, test } from '@playwright/test';
import { TID } from '../src/ui/testIds.ts';

/**
 * CafAI as Decaid serves it (spec 4.4): the production build from Decaid's
 * skin entry on port 3000, which redirects to the skin's own port, talking to
 * Decaid's real API and sockets with a simulated machine and scale connected
 * (scripts/decaid-ci.sh). Before a key is saved the stats card sits under the
 * key card, so no key is needed to see the machine.
 */
test('CafAI opens from Decaid’s port 3000, ready, with the machine connected and live readings', async ({ page }) => {
  await page.goto('/');
  expect(new URL(page.url()).port, 'redirected from 3000 to the skin’s own port').not.toBe('3000');
  await expect(page.getByTestId(TID.appReady)).toBeVisible();

  const card = page.getByTestId(TID.statsCard);
  await expect(card).toBeVisible();
  await expect(card.getByTestId(TID.connectionStatus)).toContainText('DE1 connected');
  await expect(card.getByTestId(TID.groupTemp)).toContainText(/\d+\.\d\s*°C/);
});
