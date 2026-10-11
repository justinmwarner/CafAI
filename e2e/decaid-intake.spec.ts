import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { CafaiMockWindow } from '../mock/browser.ts';
import { MOCK_BATCH_IDS } from '../mock/decaid/beans.ts';
import { TID } from '../src/ui/testIds.ts';
import {
  decaidRequests,
  everythingDecaidSaw,
  goTo,
  openApp,
  recordRequests,
  saveApiKey,
  sendChat,
  settledMirror,
  type SeenRequest,
} from './helpers.ts';

/**
 * A new bag starts on "Which coffee is it?" (D115), in every layout. A coffee
 * picked from Decaid's bean library fills the bag, and its loads name the
 * batch (D102). Something else leaves the bag to be described in the chat, as
 * before. A photo of the bag is read once by the coach's model into details
 * to check and confirm, and nothing keeps the image (D120); a photographed
 * coffee already in the library reuses its bean and its batch.
 *
 * The mock's library holds Red Brick (roasted 9 days ago) and Ethiopia
 * Chelchele (30 days ago); the scripted coach reads any photo as Kiambu AA
 * from Square Mile, roasted 2026-09-28 (BAG_PHOTO_ANSWER in
 * mock/anthropic/scenario.ts). e2e/fixtures/bag.jpg is a small drawn bag.
 */
const BAG_JPG = fileURLToPath(new URL('./fixtures/bag.jpg', import.meta.url));

/** The bag's name in the coach's header: the bag picker's chosen option. */
function bagName(page: Page): Locator {
  return page.getByTestId(TID.bagPicker).locator('option:checked');
}

/** A new bag's chat, with a key saved: "Which coffee is it?" comes first. */
async function openNewBag(page: Page): Promise<Locator> {
  await saveApiKey(page);
  await goTo(page, 'coach');
  await page.getByTestId(TID.newBag).click();
  const card = page.getByTestId(TID.beanCard);
  await expect(card.getByRole('heading', { name: 'Which coffee is it?' })).toBeVisible();
  return card;
}

/** The body of each profile load CafAI sent: a PUT /api/v1/workflow that carries a profile. */
async function loads(page: Page): Promise<Array<Record<string, unknown>>> {
  return (await decaidRequests(page))
    .filter((request) => request.method === 'PUT' && request.path === '/api/v1/workflow')
    .map((request) => request.body as Record<string, unknown>)
    .filter((body) => body !== null && typeof body === 'object' && 'profile' in body);
}

/** Every POST that would add a bean or a batch to Decaid's library. */
async function libraryAdds(page: Page): Promise<string[]> {
  return (await decaidRequests(page))
    .filter((request) => request.method === 'POST' && /^\/api\/v1\/beans(\/[^/]+\/batches)?$/.test(request.path))
    .map((request) => request.path);
}

/** The requests that went to Anthropic. */
function toAnthropic(seen: SeenRequest[]): SeenRequest[] {
  return seen.filter((request) => new URL(request.url).hostname === 'api.anthropic.com');
}

/** The base64 of every image in a request to Anthropic. */
function imagesIn(request: SeenRequest): string[] {
  const body = JSON.parse(request.body ?? '{}') as { messages?: Array<{ content?: unknown }> };
  return (body.messages ?? [])
    .flatMap((message) => (Array.isArray(message.content) ? (message.content as Array<Record<string, unknown>>) : []))
    .filter((block) => block.type === 'image')
    .map((block) => String((block.source as Record<string, unknown> | undefined)?.data ?? ''));
}

/**
 * Everything the browser keeps for the page, read raw: localStorage and every
 * IndexedDB store, as one string, and where any binary value (a Blob, an
 * ArrayBuffer, a typed array) sits.
 */
async function browserStorage(page: Page): Promise<{ text: string; binaries: string[] }> {
  return page.evaluate(async () => {
    const binaries: string[] = [];
    const plain = (value: unknown, where: string): unknown => {
      if (value instanceof Blob || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
        binaries.push(where);
        return null;
      }
      if (Array.isArray(value)) return value.map((item, index) => plain(item, `${where}[${index}]`));
      if (value !== null && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item, `${where}.${key}`)]));
      }
      return value;
    };
    const local: Record<string, string | null> = {};
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key !== null) local[key] = localStorage.getItem(key);
    }
    const databases: Record<string, unknown> = {};
    for (const { name } of await indexedDB.databases()) {
      if (!name) continue;
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open(name);
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      const stores: Record<string, unknown> = {};
      for (const store of Array.from(db.objectStoreNames)) {
        stores[store] = await new Promise<unknown>((resolve, reject) => {
          const read = db.transaction(store, 'readonly').objectStore(store).getAll();
          read.onsuccess = () => resolve(plain(read.result, `${name}/${store}`));
          read.onerror = () => reject(read.error);
        });
      }
      db.close();
      databases[name] = stores;
    }
    return { text: JSON.stringify({ local, databases }), binaries };
  });
}

test("a coffee picked from Decaid's library fills the bag, and its loads name the batch", async ({ page }) => {
  await openApp(page);
  const card = await openNewBag(page);
  // The mock's two coffees, newest roast first, each row's button naming its coffee.
  await expect(card.getByTestId(TID.beanOption)).toHaveCount(2);
  // The name says which roast too, since two batches of one bean share the coffee's name.
  await expect(card.getByTestId(TID.beanOption).first()).toHaveAccessibleName(/^Use this: Red Brick, roasted \d{1,2} [A-Z][a-z]{2} \d{4}$/);
  await card.getByRole('button', { name: 'Use this: Ethiopia Chelchele' }).click();

  // The bag takes the coffee: the header names it, and the coach goes on to the starting profiles.
  await expect(card.getByRole('listitem').filter({ hasText: 'Ethiopia Chelchele' })).toContainText('Picked');
  await expect(bagName(page)).toHaveText('Ethiopia Chelchele');
  await page.getByTestId(TID.templatePick('blooming-espresso')).click();
  await expect(page.getByText('Loaded Ethiopia Chelchele v1 on the machine.')).toBeVisible();

  // The load names the picked batch, the coffee and its roaster in Decaid's workflow context.
  const [load] = await loads(page);
  expect(load).toMatchObject({
    context: { beanBatchId: MOCK_BATCH_IDS.heartCoffeeBatch, coffeeName: 'Ethiopia Chelchele', coffeeRoaster: 'Heart Coffee Roasters' },
  });
  // Linked when picked: nothing was added to the library.
  expect(await libraryAdds(page)).toEqual([]);
});

test('Something else closes the card, and the bag described in the chat starts the intake as before', async ({ page }) => {
  await openApp(page);
  const card = await openNewBag(page);
  await expect(card.getByTestId(TID.beanOption)).toHaveCount(2);
  await card.getByTestId(TID.beanSomethingElse).click();

  // Answered: the button gives way to the answer, and the card takes no other.
  await expect(card.getByTestId(TID.beanSomethingElse)).toHaveCount(0);
  await expect(card).toContainText('Something else');
  await expect(card.getByTestId(TID.bagPhoto)).toBeDisabled();
  for (const option of await card.getByTestId(TID.beanOption).all()) await expect(option).toBeDisabled();

  // Today's intake: the description, the details saved from it, and the starting profiles.
  await sendChat(page, 'Kiambu AA, light roast, washed');
  await expect(page.getByTestId(TID.templatePick('blooming-espresso'))).toBeVisible();
  await expect(bagName(page)).toHaveText('Kiambu AA');
});

test('a photo of the bag is read once into details to check, the edited details start the intake, and no copy of the image is kept', async ({
  page,
}) => {
  const seen = recordRequests(page);
  await openApp(page);
  const card = await openNewBag(page);
  await card.getByTestId(TID.bagPhotoInput).setInputFiles(BAG_JPG);

  // The details read from it, to check: every one in a field that can be changed.
  const confirm = page.getByTestId(TID.bagConfirm);
  const name = confirm.getByLabel('Name', { exact: true });
  await expect(name).toHaveValue('Kiambu AA');
  await expect(confirm.getByLabel('Roaster')).toHaveValue('Square Mile');
  await expect(confirm.getByLabel('Origin')).toHaveValue('Kenya, Kiambu');
  await expect(confirm.getByLabel('Process')).toHaveValue('washed');
  await expect(confirm.getByLabel('Roast level')).toHaveValue('light');
  await expect(confirm.getByLabel('Roast date')).toHaveValue('2026-09-28');
  await expect(confirm.getByLabel('Tasting notes')).toHaveValue('blackcurrant, grapefruit, brown sugar');
  await expect(card).toContainText('Photo of the bag');
  await name.fill('Kiambu AA Peaberry');
  await confirm.getByRole('button', { name: 'Confirm' }).click();

  // Confirmed as edited: the bag carries the new name, and the coach goes on to the starting profiles with it.
  await expect(confirm).toContainText('Confirmed');
  await expect(confirm).toContainText('Kiambu AA Peaberry');
  await expect(bagName(page)).toHaveText('Kiambu AA Peaberry');
  await expect(page.getByTestId(TID.templatePick('blooming-espresso'))).toBeVisible();
  const intake = toAnthropic(seen).find((request) => (request.body ?? '').includes('The user confirmed these details read from a photo of the bag'));
  expect(intake?.body).toContain('The user confirmed these details read from a photo of the bag: Kiambu AA Peaberry by Square Mile;');

  // Not in Decaid's library yet: added, as a bean and a batch with the bag's roast date.
  await expect(page.getByText("Added to Decaid's beans.")).toBeVisible();
  const added = await page.evaluate(() => {
    const state = (window as CafaiMockWindow).__CAFAI_MOCK__!.state;
    const bean = state.listBeans().find((candidate) => candidate.name === 'Kiambu AA Peaberry');
    return bean ? { roaster: bean.roaster, roastDates: state.listBatches({ beanId: bean.id }).map((batch) => batch.roastDate) } : null;
  });
  expect(added).toEqual({ roaster: 'Square Mile', roastDates: [expect.stringMatching(/^2026-09-28/)] });

  // The photo went to the coach's model in one request, and in no later one.
  const withPhoto = toAnthropic(seen).filter((request) => imagesIn(request).length > 0);
  expect(withPhoto).toHaveLength(1);
  const [sent] = imagesIn(withPhoto[0]!);
  expect(sent!.length).toBeGreaterThan(1000);
  const marker = sent!.slice(500, 564);
  // Nothing kept it: not the browser's storage, nor Decaid's requests, store, shots or workflow, once the backup has settled.
  await settledMirror(page, 'Kiambu AA Peaberry');
  const stored = await browserStorage(page);
  expect(stored.binaries).toEqual([]);
  expect(stored.text).toContain('Kiambu AA Peaberry');
  expect(stored.text).not.toContain(marker);
  expect(stored.text).not.toContain('data:image');
  const decaid = await everythingDecaidSaw(page);
  expect(decaid).not.toContain(marker);
  expect(decaid).not.toContain('data:image');
});

test("a photo of a coffee already in Decaid's library reuses its bean and its batch", async ({ page }) => {
  await openApp(page);
  // The photo's coffee, in the library already: the same roaster, name and roast date.
  const seeded = await page.evaluate(() => {
    const state = (window as CafaiMockWindow).__CAFAI_MOCK__!.state;
    const bean = state.createBean({ roaster: 'Square Mile', name: 'Kiambu AA', country: 'Kenya' });
    const batch = state.createBatch(bean.id, { roastDate: '2026-09-28', roastLevel: 'light' });
    return { beanId: bean.id, batchId: batch.id };
  });
  const card = await openNewBag(page);
  await expect(card.getByRole('button', { name: 'Use this: Kiambu AA' })).toBeVisible();
  // Photographed rather than picked.
  await card.getByTestId(TID.bagPhotoInput).setInputFiles(BAG_JPG);
  const confirm = page.getByTestId(TID.bagConfirm);
  await expect(confirm.getByLabel('Name', { exact: true })).toHaveValue('Kiambu AA');
  await confirm.getByRole('button', { name: 'Confirm' }).click();

  await expect(page.getByText("Already in Decaid's beans.")).toBeVisible();
  await expect(page.getByText("Added to Decaid's beans.")).toHaveCount(0);
  // Nothing added: no bean or batch was posted, and the library holds the one bean with its one batch.
  expect(await libraryAdds(page)).toEqual([]);
  const library = await page.evaluate((beanId) => {
    const state = (window as CafaiMockWindow).__CAFAI_MOCK__!.state;
    return {
      beans: state.listBeans().filter((bean) => bean.name === 'Kiambu AA').map((bean) => bean.id),
      batches: state.listBatches({ beanId }).map((batch) => batch.id),
    };
  }, seeded.beanId);
  expect(library).toEqual({ beans: [seeded.beanId], batches: [seeded.batchId] });

  // The bag's loads name the batch it reused.
  await page.getByTestId(TID.templatePick('blooming-espresso')).click();
  await expect(page.getByText('Loaded Kiambu AA v1 on the machine.')).toBeVisible();
  const [load] = await loads(page);
  expect(load).toMatchObject({ context: { beanBatchId: seeded.batchId, coffeeName: 'Kiambu AA', coffeeRoaster: 'Square Mile' } });
});
