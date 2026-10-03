# Brief: storage

Read `docs/briefs/COMMON.md` first; its rules apply.

**You own:** `src/storage/**` except `src/storage/types.ts` (read-only
contract).

**Read:** `src/storage/types.ts` (records and interfaces you implement),
`src/api/types.ts` (`KvClient`, which you use but do not implement),
`docs/verified/01-platform.md` sections 2 and 4 (origins, storage survival,
the KV store), `DECISIONS.md` D16, `docs/CREMA_PORT_PLAN.md` sections 3.5 and
10 "[4] Storage" and conflicts C12-C15.

**Crema to port:** `settings.ts` (split into settings + secrets), the mirror
half of `store.ts`, the hydrate/mirror rules from `main.ts:1883-1923`, with
`settings-mirror.test.ts` (adapted) and the `isReady` case of
`provider.test.ts` (re-targeted to "an API key is stored").

## Rules

- IndexedDB is the primary store; every mutation is committed before the
  promise resolves (await the transaction's `done`). No write-on-unload.
- The API key lives ONLY in the secret store: never exported, never
  mirrored, never logged, never in an error message.
- Non-secret data is mirrored to Decaid's KV store, namespace `cafai`, keys
  `[a-z0-9._-]` only, every value JSON, each value under 1 MiB.
- Never write any other namespace (DYE2 owns `dye2.reaplugin`).

## Build

1. `db.ts`: `openCafaiDb(name = 'cafai')` with `idb`: object stores `bags`
   (keyPath `id`), `versions` (keyPath `id`, index `bagId`), `iterations`
   (keyPath `id`, indexes `bagId`, `createdAt`), `conversations` (keyPath
   `id`), `settings` (single record). Handle `blocked`/`versionchange` by
   closing. Best-effort `navigator.storage.persist()`.
2. `repositories.ts`: implementations of `BagRepository`,
   `VersionRepository` (listByBag sorted by version), `IterationRepository`
   (listByBag sorted by createdAt), `ConversationRepository`,
   `SettingsRepository` (defaults: `{ model: <defaultModel option>,
   grinderName: null, grinderSetting: null, activeBagId: null }`). Records
   are stored as given (the engine sets `updatedAt`). Every successful write
   calls `mirror.schedulePush()`.
3. `secrets.ts`: `SecretStore` in a SEPARATE IndexedDB database
   (`cafai-secrets`) so that import/replace/export can never touch it.
   Trim keys on save; empty -> forget.
4. `porter.ts`: `DataPorter`. `exportAll()` builds a `CafaiExport` (no
   secrets). `importAll(data, mode)`: validate with a zod schema first
   (clear error sentence on failure, e.g. "This is not a CafAI export
   file."); `replace` clears the data stores (never the secrets DB) then
   writes; `merge` upserts records whose incoming `updatedAt` (or
   `createdAt` for versions) is newer or missing locally. Returns the count.
   Also export helpers `serializeExport(e): string` (pretty JSON) and
   `exportFileName(date): string` (`cafai-export-2026-10-03.json`).
5. `mirror.ts`: `KvMirror` over a `KvClient`. Debounce 2 s; keys `meta`
   (`{schemaVersion, appVersion, updatedAt}`), `settings`, `bags`,
   `versions`, `iterations` (strip `summary.series` to keep values small;
   Crema's plan: mirror summaries, not raw curves), and `conv.<bagId>` per
   conversation (skip any value over 512 KiB and note it in `meta`). Skip
   unchanged keys (compare serialized text). Never throws; keep the last
   error for diagnostics (`lastError`). `pull()` reads `?full=1` and rebuilds a
   `CafaiExport` (missing series stay absent), or returns null when the
   namespace is empty. A test asserts no mirrored value ever contains the
   stored API key.
6. `index.ts`: `createIdbStorage({ kv, appVersion, defaultModel, dbName?, secretsDbName?, now?, debounceMs? }): Promise<Storage>`,
   `restoreFromMirrorIfEmpty(storage): Promise<boolean>` (when there are no
   bags locally and the mirror has data, import it with `merge`; port
   Crema's "fill blanks, never overwrite local" rule), and the porter
   helpers.

## Tests

With `fake-indexeddb` (already global via `src/test/setup.ts`; use a unique
db name per test) and an in-memory fake `KvClient` (write your own in a test
helper): CRUD for every repository; data survives a fresh
`createIdbStorage` on the same db name ("reload"); export/import round trip
in both modes; invalid import rejected with a clear message; secrets
untouched by replace and absent from export; mirror debounce with fake
timers, one push per burst, unchanged keys skipped, oversize conversation
skipped, failures swallowed; pull rebuilds the export;
`restoreFromMirrorIfEmpty` only restores into an empty store.
