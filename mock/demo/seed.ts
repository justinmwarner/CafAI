/**
 * Writing a built demo (mock/demo/build.ts) where the app will find it.
 *
 * CafAI's storage is replaced through its own porter (importAll 'replace':
 * the export schema checks every record, and each database takes them in one
 * transaction), the placeholder key goes into its own secrets database, and
 * every connection is closed before createServices() opens its own. The mock
 * Decaid gets the story's shots, CafAI's profiles and the workflow through
 * the restore its ?mockPersist uses (mock/persist.ts), so only its public API
 * is touched.
 */
import { DEFAULT_MODEL } from '../../src/llm/models.ts';
import { CARE_DB_NAME, openCareDb } from '../../src/storage/careDb.ts';
import { CAFAI_DB_NAME, createDbHandle, openCafaiDb } from '../../src/storage/db.ts';
import { createDataPorter } from '../../src/storage/porter.ts';
import { openSecretStore, SECRETS_DB_NAME } from '../../src/storage/secrets.ts';
import type { CafaiExport } from '../../src/storage/types.ts';
import type { MockDecaid } from '../decaid/state.ts';
import { restoreStore, type MockStoreSnapshot } from '../persist.ts';
import type { DemoDbNames } from './guard.ts';
import { DEMO_API_KEY } from './story.ts';

/**
 * The key first: on its own it is not CafAI data (the guard ignores the
 * demo's placeholder), so a load that fails after it can still seed next time.
 */
export async function writeDemoStorage(data: CafaiExport, names: DemoDbNames = {}): Promise<void> {
  const secrets = await openSecretStore(names.secretsDbName ?? SECRETS_DB_NAME);
  try {
    await secrets.setApiKey(DEMO_API_KEY);
  } finally {
    secrets.close();
  }
  const handle = createDbHandle((onLost) => openCafaiDb(names.dbName ?? CAFAI_DB_NAME, onLost));
  const careHandle = createDbHandle((onLost) => openCareDb(names.careDbName ?? CARE_DB_NAME, onLost));
  try {
    const porter = createDataPorter({
      db: () => handle.get(),
      careDb: () => careHandle.get(),
      secrets: { getApiKey: async () => DEMO_API_KEY },
      // The app's own mirror backs the records up to the mock Decaid once it runs.
      mirror: { schedulePush() {} },
      appVersion: data.appVersion,
      defaultModel: DEFAULT_MODEL,
      now: () => new Date(),
    });
    await porter.importAll(data, 'replace');
  } finally {
    handle.close();
    careHandle.close();
  }
}

/** Put the story's Decaid side into the running mock: shots, CafAI's profiles, and the workflow with the active version. */
export function seedMockDecaid(state: MockDecaid, snapshot: MockStoreSnapshot): void {
  const { skipped } = restoreStore(state, snapshot);
  if (skipped.length > 0) throw new Error(`The mock Decaid refused part of the demo: ${skipped.join(', ')}.`);
}
