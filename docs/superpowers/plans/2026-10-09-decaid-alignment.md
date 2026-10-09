# Decaid alignment and update safety: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CafAI checks itself against Decaid's published API at typecheck, in its mock, against a real Decaid and at runtime, fails safe and visibly when Decaid changes, follows Decent's platform patterns, and uses the Decaid features the owner chose.

**Architecture:** Decaid v0.8.8's specs are vendored under `contract/decaid/` with generated types and compile-time checks against `src/api/types.ts`; the same specs drive an ajv test of the mock, a drift watch against newer Decaid, and a vitest suite against a running Decaid. At runtime every Decaid reply passes a tolerant reader that reports drift to one log shown in Settings > About. The features hang off the existing client, engine and UI.

**Tech stack:** React 19, TypeScript 5.9 (strict, `noUncheckedIndexedAccess`, `erasableSyntaxOnly`), MUI 9, zod 4, vitest 5, Playwright 1.63, MSW 2, openapi-typescript 7.13, ajv 8, yaml 2, Node 24.

**Spec:** `docs/superpowers/specs/2026-10-09-decaid-alignment-design.md` (section numbers below refer to it). Audit reports: `docs/audit/2026-10-09/`. The type experiment's scripts: `.ref/cafai-audit-typegen/` (not in git).

**How this plan is written.** The owner wants momentum (no review gates after approval, parallel agents, one combined review per task). Wave 0 is given in full code. Waves 1 to 4 are briefs: exact files, interfaces with code, the tests to write (by name and assertion), the commands, and when the task is done. Each agent reads the code it changes and works test first.

**Process rules for every agent:**

- Work in `E:\source\cafai` on branch `feat/decaid-alignment`. No state-changing git: the integrator commits after each wave.
- Change only the files your task owns (the table below). If you need a change elsewhere, say so in your report instead.
- Chromium 91 (the floor of Decent's tablets): no JS or CSS newer than it; ESLint's ban list in `eslint.config.js` must stay green.
- No em dashes in UI text or code comments. Match the surrounding code's style and comment density.
- Never write, log or send the API key anywhere except where section 5.6 says.
- Write files with the Write and Edit tools (the repo is LF; Python on this machine writes CRLF).
- Capture exit codes: `cmd > "$TEMP/x.log" 2>&1; echo exit=$?` (a pipe hides them).
- Other agents edit the tree at the same time: run your own tests (`npx vitest run <your files>`) and `npx tsc -p tsconfig.json --noEmit`, and ignore errors in files you do not own. Never run `npm run e2e` or anything on port 4174 unless your task says so.
- Report back: what you built, the tests you added and their results, anything you could not do, and anything another task must know.

---

## File structure

| File | Wave | Owner | Responsibility |
|---|---|---|---|
| `package.json`, `package-lock.json` | 0 | integrator | `yaml`, `ajv`, `ajv-formats`; the new scripts |
| `src/api/drift.ts` (+ test) | 0 | integrator | the drift log (D95, D96) and its report text |
| `src/api/types.ts` | 0, 1 | integrator, api | new wire types and client methods (0); readers' fallout (1) |
| `src/api/client.ts` (+ test) | 0, 1 | integrator, api | the new calls (0); readers, probe (1) |
| `src/api/plugins.ts` (+ test) | 0 | integrator | which plugins are loaded (D103) |
| `src/storage/keyBackup.ts` (+ test) | 0 | integrator | the key's optional copy in Decaid (D99) |
| `src/storage/types.ts`, `schema.ts`, `index.ts` | 0, 2 | integrator, engine | new `Bag` fields, `KeyBackup`, mirror health (0); restore (2) |
| `src/app/types.ts`, `src/app/createServices.ts` | 0, 2 | integrator, engine | `plugins` in Services (0); late restore (2) |
| `src/ui/testing/fakeServices.ts`, `src/ui/testIds.ts` | 0 | integrator | fakes for the new calls; new test ids |
| `contract/decaid/**`, `tsconfig.contract.json`, `scripts/decaid-contract.mjs`, `scripts/decaid-watch.mjs`, `src/api/decaidVersion.ts`, `mock/decaid/contract.test.ts`, `.github/workflows/decaid-watch.yml`, `docs/upstream/decaid-spec-fixes.md`, `eslint.config.js` | 1 | contract | 4.1, 4.2, 4.3, 4.8 |
| `vitest.decaid.config.ts`, `src/api/live/**`, `scripts/decaid-ci.sh`, `playwright.real.config.ts`, `e2e-real/**`, `.github/workflows/decaid-live.yml`, `.github/workflows/release.yml`, `docs/SIMULATOR.md` | 1 | live | 4.4, 4.7 |
| `src/api/readers.ts` (+ test), `src/api/http.ts`, `kv.ts`, `frames.ts`, `telemetry.ts`, `workflow.ts`, `machineProfile.ts`, `src/ui/machine/commands.ts`, `format.ts`, `MachineStatus.tsx`, `MachineRow.tsx`, `shotBuffer.ts`, `shotTrace.ts`, `LiveShotGraph.tsx` (+ their tests) | 1 | api | 4.5, 5.3, 5.7, 5.8, 5.9, 5.13, 5.14 (probe) |
| `mock/decaid/**` (not `contract.test.ts`), `mock/fixtures/**`, `mock/demo/seed.ts` | 1 | mock | section 7's mock and seed |
| `src/app/engine/**`, `src/storage/mirror.ts`, `src/storage/index.ts`, `src/app/createServices.ts`, `src/ui/chat/CoachScreen.tsx` (setup card text only) | 2 | engine | 5.2, 5.4, 5.5, 5.10, 5.11, 5.12, 5.14 (use), 6.1 (data, loads, adding) |
| `src/ui/machine/MachineAlerts.tsx`, `StatsCard.tsx`, `ShotView.tsx`, `useScaleRevive.ts`, `useGatewayMode.ts`, `src/api/telemetry.ts` (time-to-ready), `src/ui/shell/AppShell.tsx` (+ tests) | 2 | machine | 5.1, 6.2, 6.3, 6.7 |
| `src/ui/settings/**` (+ tests) | 2 | settings | 4.6, 5.6 (switch), 5.15, 6.6 |
| `src/coach/**`, `src/app/engine/**`, `src/ui/chat/**`, `src/ui/history/**`, `src/llm/**`, `mock/anthropic/**`, `docs/briefs/ENGINE_PROTOCOL.md` | 3 | intake | 6.1 (card, coach), 6.4, 6.5, 6.8 |
| `e2e/**`, `tools/chrome91/**` | 4 | e2e | the new flows; the Chromium 91 loop |
| `DECISIONS.md`, `README.md`, `DESIGN.md`, `docs/HARDWARE_TEST_PLAN.md`, `MORNING.md` | 4 | docs | D93-D104 and the docs |

---

## Wave 0: shared foundations (integrator)

### Task 0.1: Dependencies and scripts

**Files:** Modify `package.json`, `package-lock.json`.

- [ ] **Step 1: Install**

Run: `npm install -D --save-exact yaml@2.9.1 ajv@8.20.0 ajv-formats@3.0.1 > "$TEMP/npm.log" 2>&1; echo exit=$?`
Expected: `exit=0`; the three appear in `devDependencies` with exact versions.

- [ ] **Step 2: Scripts.** In `package.json` `scripts`, set:

```json
"typecheck": "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.contract.json --noEmit && node scripts/decaid-contract.mjs --check",
"decaid:update": "node scripts/decaid-contract.mjs --update",
"decaid:watch": "node scripts/decaid-watch.mjs",
"test:decaid": "vitest run --config vitest.decaid.config.ts",
"e2e:real": "playwright test --config playwright.real.config.ts",
```

`npm run typecheck` fails until the contract task lands; during wave 1 agents run `npx tsc -p tsconfig.json --noEmit` instead.

### Task 0.2: The drift log

**Files:** Create `src/api/drift.ts`, `src/api/drift.test.ts`.

- [ ] **Step 1: Write the failing test** (`src/api/drift.test.ts`):

```ts
import { describe, expect, it, vi } from 'vitest';
import { createDriftLog, formatDriftReport } from './drift.ts';

const at = (iso: string) => () => new Date(iso);

describe('drift log', () => {
  it('keeps one entry per source and problem, counting repeats', () => {
    const warn = vi.fn();
    const log = createDriftLog({ now: at('2026-10-09T10:00:00Z'), warn });
    log.report({ source: 'ws/v1/machine/snapshot', problem: 'pressure: missing' });
    log.report({ source: 'ws/v1/machine/snapshot', problem: 'pressure: missing' });
    log.report({ source: 'GET /api/v1/workflow', problem: 'profile: missing' });
    expect(log.list()).toEqual([
      { source: 'ws/v1/machine/snapshot', problem: 'pressure: missing', count: 2, firstAt: '2026-10-09T10:00:00.000Z', lastAt: '2026-10-09T10:00:00.000Z' },
      { source: 'GET /api/v1/workflow', problem: 'profile: missing', count: 1, firstAt: '2026-10-09T10:00:00.000Z', lastAt: '2026-10-09T10:00:00.000Z' },
    ]);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('notifies on new entries only and keeps the same list until one arrives', () => {
    const log = createDriftLog({ warn: () => {} });
    const listener = vi.fn();
    log.subscribe(listener);
    log.report({ source: 'a', problem: 'b' });
    const first = log.list();
    log.report({ source: 'a', problem: 'b' });
    expect(log.list()).toBe(first);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stops adding kinds at the limit', () => {
    const log = createDriftLog({ warn: () => {}, limit: 2 });
    for (const problem of ['x', 'y', 'z']) log.report({ source: 's', problem });
    expect(log.list().map((entry) => entry.problem)).toEqual(['x', 'y']);
  });

  it('formats a report a person can paste into an issue', () => {
    const log = createDriftLog({ now: at('2026-10-09T10:00:00Z'), warn: () => {} });
    log.report({ source: 'GET /api/v1/workflow', problem: 'profile: missing' });
    expect(formatDriftReport(log.list(), { appVersion: '0.1.0', decaidVersion: '0.9.0', verifiedWith: '0.8.8' })).toBe(
      'CafAI 0.1.0 with Decaid 0.9.0 (verified with 0.8.8)\n' +
        'GET /api/v1/workflow: profile: missing (1 time, first 2026-10-09T10:00:00.000Z)',
    );
  });
});
```

- [ ] **Step 2: Run it to see it fail.** Run: `npx vitest run src/api/drift.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** (`src/api/drift.ts`):

```ts
/**
 * What Decaid sent that CafAI did not expect (D95, D96).
 *
 * A reader or parser that meets a reply it cannot fully use reports it here,
 * instead of crashing, showing a silent 0 or retrying forever. Settings >
 * About lists the entries and copies them as a report. An entry names a
 * route or channel and a field path, with types and enum values only: never
 * free text, a note or the API key.
 */
export interface DriftReport {
  /** A route or channel: "GET /api/v1/workflow", "ws/v1/machine/shotState". */
  source: string;
  /** A field path and what was wrong: "profile: missing", 'state: unknown value "brewing"'. */
  problem: string;
}

export interface DriftEntry extends DriftReport {
  count: number;
  firstAt: string;
  lastAt: string;
}

export interface DriftLog {
  report(entry: DriftReport): void;
  /** The same array until a new kind arrives (for useSyncExternalStore); counts update in place. */
  list(): readonly DriftEntry[];
  subscribe(listener: () => void): () => void;
  clear(): void;
}

export interface DriftLogOptions {
  now?: () => Date;
  /** Once per new kind; Decaid serves the WebView's console at /api/v1/webview/logs. */
  warn?: (message: string) => void;
  /** Kinds kept; later kinds are dropped. */
  limit?: number;
}

const DEFAULT_LIMIT = 50;

export function createDriftLog(options: DriftLogOptions = {}): DriftLog {
  const now = options.now ?? (() => new Date());
  const warn = options.warn ?? ((message: string) => console.warn(message));
  const limit = options.limit ?? DEFAULT_LIMIT;
  let entries: DriftEntry[] = [];
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };

  return {
    report({ source, problem }) {
      const at = now().toISOString();
      const known = entries.find((entry) => entry.source === source && entry.problem === problem);
      if (known) {
        known.count += 1;
        known.lastAt = at;
        return;
      }
      if (entries.length >= limit) return;
      entries = [...entries, { source, problem, count: 1, firstAt: at, lastAt: at }];
      warn(`CafAI: Decaid sent something unexpected. ${source}: ${problem}`);
      notify();
    },
    list: () => entries,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    clear() {
      entries = [];
      notify();
    },
  };
}

/** The app-wide log. A module singleton, like a logger: the frame parsers are pure functions. */
export const driftLog: DriftLog = createDriftLog();

export function reportDrift(source: string, problem: string): void {
  driftLog.report({ source, problem });
}

export interface DriftReportContext {
  appVersion: string;
  decaidVersion: string | null;
  verifiedWith: string;
}

/** The text Settings > About copies. */
export function formatDriftReport(entries: readonly DriftEntry[], context: DriftReportContext): string {
  const head = `CafAI ${context.appVersion} with Decaid ${context.decaidVersion ?? 'version unknown'} (verified with ${context.verifiedWith})`;
  const lines = entries.map(
    (entry) => `${entry.source}: ${entry.problem} (${entry.count} ${entry.count === 1 ? 'time' : 'times'}, first ${entry.firstAt})`,
  );
  return [head, ...lines].join('\n');
}
```

- [ ] **Step 4: Run it to see it pass.** Run: `npx vitest run src/api/drift.test.ts`. Expected: 4 passed.

### Task 0.3: Wire types and client calls

**Files:** Modify `src/api/types.ts`, `src/api/client.ts`, `src/api/client.test.ts`, `src/ui/testing/fakeServices.ts`.

- [ ] **Step 1: Types** (`src/api/types.ts`). In `WorkflowContext`, after `grinderSetting`:

```ts
  /** The linked grinder's burrs; Decaid fills it when a shot is stored (on main after v0.8.8). */
  grinderBurrs?: string | null;
```

In `DecaidSettings`, replace `gatewayMode?: string;` with:

```ts
  /** "full": Decaid leaves stop-at-weight (and tare) to the skin. "tracking", "disabled": Decaid stops the shot. */
  gatewayMode?: 'disabled' | 'full' | 'tracking' | (string & {});
```

After `DecaidSettings`, add:

```ts
/** One installed plugin (GET /api/v1/plugins): only what CafAI reads. */
export interface PluginInfo {
  id: string;
  name?: string;
  version?: string;
  /** Running now. */
  loaded?: boolean;
  [key: string]: unknown;
}

/** A coffee in Decaid's bean library (GET /api/v1/beans). */
export interface Bean {
  id: string;
  roaster?: string;
  name?: string;
  country?: string;
  region?: string;
  processing?: string;
  notes?: string;
  archived?: boolean;
  createdAt?: string;
  updatedAt?: string;
  extras?: Record<string, unknown>;
  [key: string]: unknown;
}

/** One roast of a bean (GET /api/v1/beans/{id}/batches). Dates are ISO strings. */
export interface BeanBatch {
  id: string;
  beanId: string;
  roastDate?: string | null;
  roastLevel?: string | null;
  freezeDate?: string | null;
  unfreezeDate?: string | null;
  /** In the freezer now. */
  frozen?: boolean;
  archived?: boolean;
  createdAt?: string;
  extras?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface BeanCreateRequest {
  roaster: string;
  name: string;
  country?: string;
  processing?: string;
  notes?: string;
}

export interface BatchCreateRequest {
  roastDate?: string;
  roastLevel?: string;
}

/** ws/v1/plugins/time-to-ready.reaplugin/timeToReady frames. */
export interface TimeToReadyFrame {
  status: 'heating' | 'reached' | 'not_heating' | 'insufficient_data' | (string & {});
  /** ms until ready, when the plugin has an estimate. */
  remainingTimeMs: number | null;
}

/** Decaid's enjoyment scale: 0-10 on current builds, 0-100 on 0.8.6 field builds (D101). */
export type EnjoymentScale = 10 | 100;
```

In `DecaidClient`, after `getSettings(): Promise<DecaidSettings>;`:

```ts
  /** POST /api/v1/settings (answers null): only the keys given change. Answers the settings read after. */
  updateSettings(patch: Pick<DecaidSettings, 'gatewayMode'>): Promise<DecaidSettings>;
  listPlugins(): Promise<PluginInfo[]>;
  /** GET a loaded plugin's HTTP endpoint, e.g. ("dye2.reaplugin", "recent-favs"). */
  getPluginEndpoint<T = unknown>(pluginId: string, endpoint: string): Promise<T | null>;
```

after `tareScale(): Promise<void>;`:

```ts
  /** Discovery only: never `connect=true`, which reconnects everything it sees. */
  scanDevices(options?: { quick?: boolean }): Promise<DeviceEntry[]>;
  connectDevice(deviceId: string, connectionRole?: 'primary' | 'auxiliary'): Promise<unknown>;
  /** Find and connect ONE device of a kind, leaving the others alone; returns the device list after. */
  connectKind(kind: 'machine' | 'scale'): Promise<DeviceEntry[]>;
```

and after `updateShot(...)`:

```ts
  /** D101: 10 or 100, or null when Decaid could not be asked. */
  probeEnjoymentScale(): Promise<EnjoymentScale | null>;

  listBeans(): Promise<Bean[]>;
  listBatches(beanId: string): Promise<BeanBatch[]>;
  createBean(request: BeanCreateRequest): Promise<Bean>;
  createBatch(beanId: string, request: BatchCreateRequest): Promise<BeanBatch>;
```

- [ ] **Step 2: Client** (`src/api/client.ts`). Remove `scanDevices`/`connectDevice`/`connectKind` from `GatewayClient` (keep `export type GatewayClient = DecaidClient;` so imports keep working). Add, beside the existing calls:

```ts
    async updateSettings(patch) {
      // Decaid answers 200 null (settings_handler.dart at aab5f93): read them back.
      await requestJson(transport, '/api/v1/settings', { method: 'POST', body: patch });
      return client.getSettings();
    },
    async listPlugins() {
      return (await requestJson<PluginInfo[]>(transport, '/api/v1/plugins')) ?? [];
    },
    getPluginEndpoint: <T>(pluginId: string, endpoint: string) =>
      requestJson<T>(transport, `/api/v1/plugins/${id(pluginId)}/${id(endpoint)}`),
    async probeEnjoymentScale() {
      // A made-up id: current builds validate enjoyment (0-10) before looking
      // the shot up, 0.8.6 field builds look it up first (decaid-mcp's probe).
      try {
        await requestJson(transport, `/api/v1/shots/${id(newId('cafai-probe'))}`, {
          method: 'PUT',
          body: { annotations: { enjoyment: 11 } },
        });
        return null;
      } catch (error) {
        if (!(error instanceof GatewayError)) return null;
        if (error.status === 404) return 100;
        const said = [error.body?.error, error.body?.message, error.body?.details, error.message].join(' ');
        return error.status === 400 && /enjoyment/i.test(said) ? 10 : null;
      }
    },
    async listBeans() {
      return (await requestJson<Bean[]>(transport, '/api/v1/beans')) ?? [];
    },
    async listBatches(beanId) {
      return (await requestJson<BeanBatch[]>(transport, `/api/v1/beans/${id(beanId)}/batches`)) ?? [];
    },
    createBean: (request) => requestValue<Bean>(transport, '/api/v1/beans', { method: 'POST', body: request }),
    createBatch: (beanId, request) =>
      requestValue<BeanBatch>(transport, `/api/v1/beans/${id(beanId)}/batches`, { method: 'POST', body: request }),
```

(`newId` from `../util/id.ts`, `GatewayError` from `./types.ts`.)

- [ ] **Step 3: Client tests** (`src/api/client.test.ts`), following the file's fake-fetch pattern:
  - `updateSettings` POSTs `{"gatewayMode":"tracking"}` to `/api/v1/settings` (answered `null`), then GETs the settings and answers them.
  - `listPlugins` turns a `null` body into `[]`.
  - `probeEnjoymentScale`: 400 `{"error":"Invalid request","message":"enjoyment must be between 0 and 10"}` gives `10`; 404 gives `100`; 200 gives `null`; a network failure gives `null`; the path starts `/api/v1/shots/cafai-probe`.
  - `listBatches('bean:1')` GETs `/api/v1/beans/bean%3A1/batches`.

- [ ] **Step 4: Fakes** (`src/ui/testing/fakeServices.ts`): `createFakeDecaid()` implements the new methods with in-memory state: settings `{ gatewayMode: 'tracking' }` (updatable), plugins `[]`, beans and batches lists with create, `probeEnjoymentScale` answering `10`, `scanDevices`/`connectDevice`/`connectKind` (if they are not there yet) answering the current devices; and records calls like the existing fakes do.

- [ ] **Step 5:** Run `npx vitest run src/api/client.test.ts src/ui` and `npx tsc -p tsconfig.json --noEmit`. Expected: pass, no errors.

### Task 0.4: Plugins, the key's copy, bags, services, ids

**Files:** Create `src/api/plugins.ts` (+ test), `src/storage/keyBackup.ts` (+ test). Modify `src/storage/types.ts`, `src/storage/schema.ts`, `src/storage/index.ts`, `src/app/types.ts`, `src/app/createServices.ts`, `src/ui/testing/fakeServices.ts`, `src/ui/testIds.ts`.

- [ ] **Step 1: Plugin directory** (`src/api/plugins.ts`):

```ts
/**
 * Which of Decaid's plugins are running (D103). Read at start and again when
 * the page comes back into view; a failed read keeps the last answer, and
 * before the first answer every plugin counts as absent.
 */
import type { DecaidClient } from './types.ts';

export const PLUGIN = {
  timeToReady: 'time-to-ready.reaplugin',
  visualizer: 'visualizer.reaplugin',
  dye2: 'dye2.reaplugin',
} as const;

export interface PluginDirectory {
  isLoaded(id: string): boolean;
  refresh(): Promise<void>;
  subscribe(listener: () => void): () => void;
}

export function createPluginDirectory(client: Pick<DecaidClient, 'listPlugins'>): PluginDirectory {
  let loaded = new Set<string>();
  const listeners = new Set<() => void>();
  return {
    isLoaded: (id) => loaded.has(id),
    async refresh() {
      try {
        const plugins = await client.listPlugins();
        const next = new Set(plugins.filter((plugin) => plugin.loaded === true).map((plugin) => plugin.id));
        const changed = next.size !== loaded.size || [...next].some((id) => !loaded.has(id));
        loaded = next;
        if (changed) for (const listener of listeners) listener();
      } catch {
        // Keep the last answer.
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
```

Tests (`src/api/plugins.test.ts`): absent before refresh; `loaded: true` counts, `loaded: false` or missing does not; a failed refresh keeps the last answer; listeners fire only on change.

The `loaded` field: confirm it in Decaid's plugins handler (`.ref/decaid/lib/src/services/webserver/` — the list route) before relying on it; if the load state has another name, read that name here and in the type.

- [ ] **Step 2: Services.** In `src/app/types.ts` add `plugins: PluginDirectory;` to `Services` (import the type from `../api/plugins.ts`). In `src/app/createServices.ts`: `const plugins = createPluginDirectory(decaid); void plugins.refresh();`, refresh on `visibilitychange` to visible, and return `plugins`. In `fakeServices.ts`: a fake directory with a settable loaded set.

- [ ] **Step 3: The key's copy** (`src/storage/keyBackup.ts`):

```ts
/**
 * The API key's optional copy in Decaid (D99). Off by default. When on, the
 * key is kept in its own namespace, never in `cafai`, which the mirror,
 * export and import use; so the backup of CafAI's records never carries it.
 * Any device on the network can read Decaid's store, and Decaid's backups
 * include it: Settings says so where the switch is.
 */
import type { KvClient } from '../api/types.ts';
import type { SecretStore } from './types.ts';

export const KEY_NAMESPACE = 'cafai-key';
export const KEY_NAME = 'anthropic';

export interface KeyBackup {
  /** Whether Decaid holds a copy. Throws when Decaid cannot be reached. */
  isOn(): Promise<boolean>;
  /** On: copy the current key to Decaid. Off: delete the copy. */
  setOn(on: boolean): Promise<void>;
  /** After the key changes on this device: refresh the copy when it is on. Never throws. */
  keyChanged(): Promise<void>;
  /** At boot: no key here and a copy in Decaid brings it back. True when restored. Never throws. */
  restoreIfMissing(): Promise<boolean>;
}

export function createKeyBackup(kv: KvClient, secrets: SecretStore): KeyBackup {
  const stored = async () => {
    const value = await kv.get<unknown>(KEY_NAMESPACE, KEY_NAME);
    return typeof value === 'string' && value.length > 0 ? value : null;
  };
  return {
    async isOn() {
      return (await stored()) !== null;
    },
    async setOn(on) {
      if (!on) {
        await kv.delete(KEY_NAMESPACE, KEY_NAME);
        return;
      }
      const key = await secrets.getApiKey();
      if (key) await kv.set(KEY_NAMESPACE, KEY_NAME, key);
    },
    async keyChanged() {
      try {
        if ((await stored()) === null) return;
        const key = await secrets.getApiKey();
        if (key) await kv.set(KEY_NAMESPACE, KEY_NAME, key);
        else await kv.delete(KEY_NAMESPACE, KEY_NAME);
      } catch {
        // The next change or the switch tries again.
      }
    },
    async restoreIfMissing() {
      try {
        if (await secrets.getApiKey()) return false;
        const key = await stored();
        if (!key) return false;
        await secrets.setApiKey(key);
        return true;
      } catch {
        return false;
      }
    },
  };
}
```

Tests (`src/storage/keyBackup.test.ts`, with `src/storage/testing/memoryKv.ts` and an in-memory secret store): off by default; `setOn(true)` copies the key to `cafai-key/anthropic`; `setOn(false)` deletes it; `keyChanged` refreshes only when on, and deletes when the key was forgotten; `restoreIfMissing` restores only when the device has no key; a KV failure in `restoreIfMissing` answers false; and **nothing is ever written to the `cafai` namespace**.

- [ ] **Step 4: Storage.** `src/storage/types.ts`: add `keyBackup: KeyBackup` to `Storage`; add to `KvMirror`:

```ts
  /** When the last push finished (ISO), or null. */
  readonly lastPushAt: string | null;
  /** The last push or gate failure as a sentence, or null after a success. */
  readonly lastError: string | null;
```

and to `Bag`, after `notes`:

```ts
  /** Decaid's bean and batch this bag is linked to (D102); absent on bags made before 2026-10-09. */
  decaidBeanId?: string | null;
  decaidBatchId?: string | null;
  /** Roast date, YYYY-MM-DD. */
  roastDate?: string | null;
```

`src/storage/schema.ts` `BagSchema`: the three as `nullableText.optional()` (or the file's equivalent for an optional nullable string). `src/storage/index.ts`: build `keyBackup: createKeyBackup(kv, secrets)` and return it. Fakes: an in-memory `keyBackup`.

- [ ] **Step 5: Test ids** (`src/ui/testIds.ts`), added to `TID`:

```ts
  beanCard: 'bean-card',
  beanOption: 'bean-option',
  beanSomethingElse: 'bean-something-else',
  bagPhoto: 'bag-photo',
  bagPhotoInput: 'bag-photo-input',
  bagConfirm: 'bag-confirm',
  gatewayAlert: 'gateway-alert',
  gatewayFix: 'gateway-fix',
  connectMachine: 'connect-machine',
  connectScale: 'connect-scale',
  timeToReady: 'time-to-ready',
  visualizerLink: 'visualizer-link',
  drinkSettings: 'drink-settings',
  nextStep: 'next-step',
  keyInDecaid: 'key-in-decaid',
  aboutDecaid: 'about-decaid',
  driftReport: 'drift-report',
  copyDriftReport: 'copy-drift-report',
  backupHealth: 'backup-health',
```

- [ ] **Step 6: Verify and commit.** Run `npx tsc -p tsconfig.json --noEmit`, `npm run lint`, `npm test`. Expected: all pass (the contract part of `typecheck` is not there yet). Commit: `chore: wave 0 for Decaid alignment: drift log, new client calls, plugin directory, the key's copy`.

---

## Wave 1 (four agents in parallel)

### Task A: contract (4.1, 4.2, 4.3, 4.8)

**Files:** Create `contract/decaid/PIN.json`, `contract/decaid/spec/rest_v1.yml`, `contract/decaid/spec/websocket_v1.yml`, `contract/decaid/generated/rest.ts`, `contract/decaid/generated/ws.ts`, `contract/decaid/helpers.ts`, `contract/decaid/checks/{rest-read,rest-write,ws,enums,status}.ts`, `contract/decaid/drift.ts`, `contract/decaid/schema.ts`, `contract/decaid/README.md`, `tsconfig.contract.json`, `scripts/decaid-contract.mjs`, `scripts/decaid-contract.test.mjs`, `scripts/decaid-watch.mjs`, `src/api/decaidVersion.ts`, `mock/decaid/contract.test.ts`, `.github/workflows/decaid-watch.yml`, `docs/upstream/decaid-spec-fixes.md`. Modify `eslint.config.js` (ignore `contract/decaid/generated/**`), `.github/workflows/ci.yml` (nothing to add if `typecheck` covers it; check).

**Sources to port:** `.ref/cafai-audit-typegen/` (`conformance/diff.ts`, `diffs.ts`, `checks.ts`, `spec.ts`; `ws-gen-openapi.mjs`; `validate-examples.mjs`; `spec-diff.mjs`; `mutate-spec.mjs`) and `docs/audit/2026-10-09/typegen.md` (how they work and what they found).

- [ ] **A1. `scripts/decaid-contract.mjs`.** `--update <tag|sha>`: resolve the ref (GitHub API `repos/decentespresso/decaid/commits/<ref>`, with `GH_TOKEN`/`GITHUB_TOKEN` when set), download `assets/api/rest_v1.yml` and `assets/api/websocket_v1.yml` from `https://raw.githubusercontent.com/decentespresso/decaid/<sha>/...`, write them to `contract/decaid/spec/`, generate both files (below), write `PIN.json` (`{"release":"v0.8.8","commit":"<40-char sha>","specs":{"rest":{"file":"spec/rest_v1.yml","sha256":"..."},"ws":{...}},"generator":"openapi-typescript@7.13.0"}`; `release` is the tag when the ref is a tag, else `null`) and `src/api/decaidVersion.ts`:

```ts
// Written by scripts/decaid-contract.mjs; do not edit.
/** The Decaid release CafAI's wire types were checked against (D93). */
export const VERIFIED_DECAID = { release: '0.8.8', commit: 'aab5f93' } as const;
```

`--check`: the two spec hashes equal `PIN.json`'s; regenerating from the vendored specs gives `generated/rest.ts`, `generated/ws.ts` and `decaidVersion.ts` byte for byte; exit 1 with the names of the stale files otherwise. Generation: REST through `openapi-typescript`'s Node API (never `--enum`), WebSocket by wrapping `components.schemas` in a stub OpenAPI 3.0 document (port `ws-gen-openapi.mjs`) plus a hand-kept channel map (`WsReceive`/`WsSend` keyed by channel address). Both files start with `// Generated by scripts/decaid-contract.mjs from Decaid <sha>. Do not edit.` and use LF. Tests (`scripts/decaid-contract.test.mjs`, picked up by vitest's `scripts/**/*.test.mjs`): `--check` passes on the committed files; a changed byte in `generated/rest.ts` fails `--check`; the channel map lists every channel in the spec.

- [ ] **A2. Pin v0.8.8.** Run `npm run decaid:update -- v0.8.8`. Expected: `PIN.json` names commit `aab5f938fb3e1a8f44af24d99c6b707491b15ed7`.

- [ ] **A3. `tsconfig.contract.json`:** extends `./tsconfig.json`; `include`: `contract/decaid/**/*.ts`; `compilerOptions.paths`: `{"#decaid/rest": ["./contract/decaid/generated/rest.ts"], "#decaid/ws": ["./contract/decaid/generated/ws.ts"]}`; `noEmit`. The checks import CafAI's types from `../../src/api/types.ts` (and `src/coach/types.ts`, `src/api/grinders.ts`).

- [ ] **A4. Checks.** Port the experiment's `diff.ts` into `helpers.ts` and its checks into `checks/*.ts`, split by kind. Reads are `Diff<SpecResponse, CafaiType>`, writes `Diff<CafaiBody, SpecBody>`; each must be `Exactly` the recorded fragments. Every fragment carries a comment in the experiment's format: `/** SPEC GAP | SPEC DRIFT | CAFAI NARROWER | CAFAI LOOSER | PARSED SHAPE: why (Decaid file:line). */`. Coverage: every payload in `docs/audit/2026-10-09/cafai.md` section 1, plus settings (with `gatewayMode`), plugins, beans, batches, bean and batch create bodies, the time-to-ready frame (no spec schema: assert CafAI's type by hand against the plugin's emit at `.ref/decaid/assets/plugins/time-to-ready.reaplugin/plugin.js`), the enums CafAI branches on (machine states, substates, shotState states, device types and states), and the status codes CafAI relies on (KV miss, tare without a scale, workflow PUT). Against v0.8.8 the WebSocket device type lacks `grinder` (fixed in `a34615f`): record it as SPEC GAP. Run `npx tsc -p tsconfig.contract.json --noEmit`. Expected: no errors.

- [ ] **A5. Prove the checks bite.** In a scratch copy (port `mutate-spec.mjs`), rename `weightFlow`, make `pressure` nullable and remove a shot's `createdAt`; regenerate into a temp folder and run the contract tsc against it (a temp tsconfig that extends `tsconfig.contract.json` and repoints the two aliases). Expected: three `unexpected` errors. Put this in `scripts/decaid-contract.test.mjs` as a test.

- [ ] **A6. `contract/decaid/schema.ts`.** OpenAPI 3.0 to JSON Schema for ajv (port the converter in `validate-examples.mjs`: `nullable`, boolean `exclusiveMinimum`/`exclusiveMaximum`, `$ref` to `#/components/schemas`), and this API, which task B uses too:

```ts
export interface SpecValidator {
  /** Problems with a reply, as "path: message" strings; [] when valid. Skips the exceptions in drift.ts. */
  response(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, status: number, body: unknown): string[];
  /** Problems with a request body. */
  request(method: 'POST' | 'PUT', path: string, body: unknown): string[];
  /** Problems with a WebSocket frame on a channel ("ws/v1/machine/snapshot"). */
  frame(channel: string, frame: unknown): string[];
}
export function loadSpecValidator(specDir?: string): SpecValidator;
```

`path` is concrete (`/api/v1/shots/abc`) and matched against the spec's templates. `contract/decaid/drift.ts` lists the runtime exceptions with the same comment format, e.g. `{ where: 'any', keyword: 'format', schemaPath: /date-time/, why: 'SPEC DRIFT: telemetry and shot timestamps are local and zone-less (...)' }`.

- [ ] **A7. `mock/decaid/contract.test.ts`** (vitest): every fixture in `mock/fixtures/*.json` validates against the reply it stands for (a table maps file to method, path and status); each fixture equals its copy in `docs/verified/examples/` byte for byte; the mock's replies for every route in cafai.md section 1.2 and the new routes, and the frames of every channel during a scripted shot, validate (drive `mock/decaid/state.ts` and `ws.ts` directly, as their own tests do); the bodies CafAI sends (workflow PUT from a bundled template, profile POST, shot PUT with notes and enjoyment, settings POST, bean and batch POST) validate as requests. Fixtures nothing imports are printed, not failed.

- [ ] **A8. `scripts/decaid-watch.mjs`** (spec 4.3): latest release and `main`; same hashes as the pin, "no spec change"; else generate into a temp folder, run the contract tsc with the aliases repointed, run the ajv fixture check against the new spec, a structural diff (operations added and removed, and whether CafAI calls them; properties added, removed or retyped in the schemas CafAI uses: port `spec-diff.mjs`), and the files changed since the pin from the compare API filtered by this watch list:

```js
const WATCH = [
  'assets/api/', 'doc/Skins.md', 'doc/Api.md',
  'lib/src/services/webserver/', 'lib/src/models/data/', 'lib/src/models/device/',
  'lib/src/skin_feature/', 'lib/src/webui_support/',
  'assets/plugins/visualizer.reaplugin/', 'assets/plugins/time-to-ready.reaplugin/', 'assets/plugins/settings.reaplugin/',
];
```

Prints markdown; `--report <file>` writes it; exit 0 (nothing or additive and passing), 1 (a check failed), 2 (GitHub unreachable). Run it now. Expected: exit 0; `main` reported as additive (`grinderBurrs`, the `grinder` device type) with the changed handler files listed.

- [ ] **A9. `.github/workflows/decaid-watch.yml`:** `schedule: cron '17 7 * * *'` and `workflow_dispatch`; `permissions: contents: read, issues: write`; `npm ci`, `npm run decaid:watch -- --report report.md`; on exit 1, `gh issue list --label decaid-drift --state open` and comment on it or `gh issue create --label decaid-drift --title "Decaid changed something CafAI reads" --body-file report.md`; exit 2 only warns.

- [ ] **A10. `docs/upstream/decaid-spec-fixes.md`** (spec 4.8): an issue text for decentespresso/decaid, each item with the spec location, the Dart evidence (file:line at `aab5f93`) and the fix; then a patch outline. From typegen.md section 3 and decaid.md section 3.5.

- [ ] **A11. `contract/decaid/README.md`:** what the folder is, how to move the pin, how to read a failing check, how to add an exception (and when not to).

- [ ] **Done when:** `npm run typecheck` passes (all three parts); `npx vitest run mock/decaid/contract.test.ts scripts` passes; `npm run decaid:watch` exits 0; `npm run lint` is clean.

### Task B: live (4.4, 4.7)

**Files:** Create `vitest.decaid.config.ts`, `src/api/live/env.ts`, `src/api/live/read.decaid.ts`, `src/api/live/write.decaid.ts`, `src/api/live/shot.decaid.ts`, `scripts/decaid-ci.sh`, `playwright.real.config.ts`, `e2e-real/real-decaid.spec.ts`, `.github/workflows/decaid-live.yml`. Modify `.github/workflows/release.yml`, `docs/SIMULATOR.md`, `tsconfig.json` (`include` gains `e2e-real`, `vitest.decaid.config.ts`, `playwright.real.config.ts`).

- [ ] **B1. `vitest.decaid.config.ts`**, modelled on `vitest.live.config.ts`: `include: ['src/**/*.decaid.ts']`, node environment, `provide: { cafaiDecaidSuite: true }`, `testTimeout: 120_000`, `retry: 0`, `fileParallelism: false`, verbose reporter. The unit config's `include` never matches `*.decaid.ts`.

- [ ] **B2. `src/api/live/env.ts`:** reads `DECAID_URL` (required; suites `describe.skipIf(!url)`), `DECAID_WRITE=1`, `DECAID_SIM=1` (implies writes); refuses to run unless `inject('cafaiDecaidSuite')` is true (so `npm test` can never reach a machine); builds CafAI's own client with `createDecaidClient({ origin: DECAID_URL })` and `loadSpecValidator()` from `contract/decaid/schema.ts` (task A6; until it lands, write against the interface in A6).

- [ ] **B3. `read.decaid.ts`:** one test per item of spec 4.4 "Always": each call through CafAI's client must resolve, and the raw reply (fetch it once more, plainly) must have no `SpecValidator.response` problems. WebSockets: open each channel CafAI opens (`src/api/telemetry.ts` lists them) with Node's global `WebSocket`, collect frames for 5 s, parse each with CafAI's parser from `src/api/frames.ts`, and check them with `SpecValidator.frame`; devices and shotState must replay at least one frame; machine, scale and water frames are required only when devices says the machine (scale) is connected. A test prints `GET /api/v1/info`'s version first.

- [ ] **B4. `write.decaid.ts`** (`describe.skipIf(!write)`): heartbeat; KV set, get, `?full=1` and delete in `cafai-contract-test`; `probeEnjoymentScale` answers 10 or 100; workflow round trip: read the workflow, PUT the bundled Blooming template (`src/coach/templates/`) with a context, check the reply with `findProfileMismatch` from `src/api/workflow.ts`, `POST /api/v1/machine/profile` with the returned profile (200 or, when no machine, the documented error), then PUT the original workflow back and confirm it; a profile created then hidden (`PUT /api/v1/profiles/{id}/visibility` or the spec's route); a bean and a batch created then archived; gateway mode read, set to `tracking`, restored. Every write is undone in `afterAll`, even after a failure.

- [ ] **B5. `shot.decaid.ts`** (`describe.skipIf(!sim)`): `PUT /api/v1/machine/state/espresso`; wait for shotState `preheating` or `pouring`, then `finished` (90 s); `GET /api/v1/shots/{shotId}`; summarise with `summarizeShot` from `src/coach/summary/`: the summary has a duration over 10 s and a peak pressure over 1 bar; `PUT` annotations (an `espressoNotes` line and `enjoyment` on the probed scale) and read them back; `idle`.

- [ ] **B6. `scripts/decaid-ci.sh`** (bash, `set -euo pipefail`): `DECAID_TAG` (default: the latest release, from `gh release view -R decentespresso/decaid --json tagName` or the API); download `decaid-linux-x64-${VERSION}.tar.gz` (the release's asset name pattern, `decaid-linux-x64-latest.tar.gz` for latest) into `$RUNNER_TEMP` or `/tmp`; extract; install the runtime libraries Decaid's own PR job installs (copy the list from `.ref/decaid/.github/workflows/pr-checks.yml`); `export XDG_DATA_HOME XDG_CONFIG_HOME XDG_CACHE_HOME` to temp folders; start `xvfb-run -a ./bundle/decaid --no-account --bypass-onboarding --skin-path="$PWD/dist"` (check the binary's name and flags in `.ref/decaid/lib/src/cli_args.dart` and `main.dart`) in the background with its log in a file; poll `GET http://localhost:8080/api/v1/devices` for 60 s; `POST /api/v1/settings {"simulatedDevices":["machine","scale"],"automaticUpdateCheck":false}`; `GET /api/v1/devices/scan?connect=true`; poll devices until the machine and the scale are connected (60 s); print `GET /api/v1/info`. A `stop` subcommand kills it. On failure, print the last 200 lines of Decaid's log.

- [ ] **B7. `e2e-real/real-decaid.spec.ts` and `playwright.real.config.ts`** (Chromium only, no web server, `baseURL: http://localhost:3000`): open `/`, follow the redirect to the skin's port, wait for `[data-testid=app-ready]`, then the stats card shows the machine connected and a group temperature that is a number, not the dash. Not part of `npm run e2e`.

- [ ] **B8. `.github/workflows/decaid-live.yml`:** `on: schedule (daily, '43 7 * * *'), workflow_dispatch (input decaid_tag, default latest), workflow_call (same input)`; ubuntu-latest; `npm ci`, `npm run build`, `bash scripts/decaid-ci.sh`, `DECAID_URL=http://localhost:8080 DECAID_WRITE=1 DECAID_SIM=1 npm run test:decaid`, `npx playwright install --with-deps chromium`, `npm run e2e:real`, `bash scripts/decaid-ci.sh stop`; upload Decaid's log and the Playwright report on failure.

- [ ] **B9. `release.yml`:** add `npx playwright install --with-deps chromium` and `npm run e2e` before the zip, and a job `decaid-live` (`uses: ./.github/workflows/decaid-live.yml`) that the publishing job `needs`.

- [ ] **B10. `docs/SIMULATOR.md`:** a section "Check CafAI against the simulator": start the simulator as the doc already says, then `DECAID_URL=http://localhost:8080 DECAID_WRITE=1 DECAID_SIM=1 npm run test:decaid`; against a tablet, only `DECAID_URL=http://<tablet-ip>:8080 npm run test:decaid` (read-only, D104).

- [ ] **Done when:** `npm run test:decaid` with no `DECAID_URL` reports every suite skipped and exits 0; `npx tsc -p tsconfig.json --noEmit` passes for your files; `bash -n scripts/decaid-ci.sh` passes; `npm test` still never runs a `*.decaid.ts` file (check the count of files). Running against a real Decaid happens in wave 4.

### Task C: api (4.5, 5.3, 5.7, 5.8, 5.9, 5.13, 5.14 probe)

**Files:** Create `src/api/readers.ts`, `src/api/readers.test.ts`. Modify `src/api/http.ts`, `client.ts`, `kv.ts`, `frames.ts`, `telemetry.ts`, `workflow.ts`, `types.ts` (the `MachineFrame` type), `src/ui/machine/commands.ts`, `format.ts`, `MachineStatus.tsx`, `MachineRow.tsx`, `shotBuffer.ts`, `shotTrace.ts`, `LiveShotGraph.tsx`, `ShotView.tsx` (reading types only), `StatsCard.tsx` (reading types only), and their tests.

- [ ] **C1. Readers.** `requestValue`/`requestJson` gain an optional `read?: (data: unknown, source: string) => T` (`source` is `"GET /api/v1/workflow"`). `src/api/readers.ts` holds zod readers built with `z.looseObject` (extra keys kept), optional where Decaid omits keys, enums as strings: `readBuildInfo`, `readMachineInfo`, `readWorkflow`, `readProfileRecord`, `readShotSummary`, `readShot`, `readSettings`, `readPlugins`, `readBeans`, `readBatches`, `readBean`, `readBatch`. Each returns CafAI's existing type. On a problem: a field CafAI cannot do without (workflow `profile` with `title` and `steps`; any record's `id`; a batch's `beanId`) throws `new GatewayError(200, path, "Decaid sent a reply CafAI doesn't recognise.", 'unexpected_reply')` after `reportDrift(source, '<path>: <what>')`; anything else is defaulted (or the bad item dropped from a list) and reported. Wire them into every `client.ts` call that now casts. Tests: a valid reply passes through untouched (extra keys kept); a missing `profile` throws `unexpected_reply` and reports `GET /api/v1/workflow` / `profile: missing`; a list with one bad bean keeps the others and reports once; `MachineInfo` without `GHC` reads as `GHC: false` and reports.

- [ ] **C2. KV (5.3).** `kv.getAll`: a reply that is not a plain object throws `GatewayError(..., 'unexpected_reply')` after `reportDrift('GET /api/v1/store/{ns}?full=1', 'reply: not an object')`; 404 answers `{ notModified: false, data: {}, etag: null }`. Tests: array, `null` and a string each throw `unexpected_reply`; 404 is empty; 200 `{}` is empty. Then check `src/storage/index.ts` and `mirror.ts` treat a throw from `getAll` as "unreadable" (no restore, gate shut, retry) and say so in your report if they do not (the engine task owns those files).

- [ ] **C3. Readings (5.8).** In `types.ts`:

```ts
/** The machine readings a snapshot carries as numbers. */
export type MachineReading =
  | 'flow' | 'pressure' | 'targetFlow' | 'targetPressure' | 'mixTemperature' | 'groupTemperature'
  | 'targetMixTemperature' | 'targetGroupTemperature' | 'profileFrame' | 'steamTemperature';

/** A parsed telemetry frame: a reading Decaid did not send is null, never 0 (5.8). */
export type MachineFrame = Omit<MachineSnapshot, MachineReading> & { [K in MachineReading]: number | null };
```

`TelemetryState.machine` and `LiveSample.machine` become `MachineFrame`. `parseMachineFrame` gives `null` for a missing or non-numeric reading and reports `ws/v1/machine/snapshot` / `<name>: missing`. Follow the TypeScript errors through `src/ui/machine/**` and `src/api/**`: a null reading shows the dash where its readout is (use `format.ts`'s existing dash), and the graph leaves the point out (uPlot draws a gap for `null`). Tests: a frame without `groupTemperature` gives `null` and one drift entry; the stats card and the Shot view show the dash for it; the graph's series gets `null`.

- [ ] **C4. Stop (5.7).** In `commands.ts`:

```ts
/** States at rest: nothing to stop. */
const AT_REST_STATES = new Set(['idle', 'schedIdle', 'sleeping', 'heating', 'preheating', 'booting', 'busy', 'needsWater', 'error']);
/** States Stop must never interrupt. */
const DO_NOT_INTERRUPT_STATES = new Set(['fwUpgrade', 'calibration', 'selfTest']);

/** D97: Stop for the known running states and for any state CafAI does not know. */
export function isStoppableMachineState(state: string | null | undefined): boolean {
  if (typeof state !== 'string' || state === '') return false;
  if (RUNNING_STATES.has(state)) return true;
  return !AT_REST_STATES.has(state) && !DO_NOT_INTERRUPT_STATES.has(state);
}

export function isKnownMachineState(state: string): boolean {
  return RUNNING_STATES.has(state) || AT_REST_STATES.has(state) || DO_NOT_INTERRUPT_STATES.has(state);
}
```

Replace every use of `isRunningMachineState` that decides whether Stop shows with `isStoppableMachineState` (the machine row, the controls model); keep `isRunningMachineState` where "a known drink is running" is meant (and say which in a comment). `parseMachineFrame` reports `state: unknown value "<state>"` for a state `isKnownMachineState` rejects. Tests: `espresso` and `airPurge` stop; `brewing` (unknown) stops and reports drift; `fwUpgrade`, `calibration`, `selfTest`, `idle`, `sleeping`, `error` do not; the machine row shows Stop for `brewing` and not for `fwUpgrade`.

- [ ] **C5. Shot detection (5.9).** In `telemetry.ts`, keep the machine-state fallback armed after shotState frames arrive: when the machine is in `espresso` and no shotState frame with a known state (`idle`, `preheating`, `pouring`, `stopping`, `finished`) has arrived for 3 s, emit `started` from the machine state, and `finished` (stop reason `null`) when the machine leaves `espresso`, unless a known shotState `finished`/`idle` came first; never emit twice for one shot. An unknown shotState `state` reports `ws/v1/machine/shotState` / `state: unknown value "<v>"`. Tests (with the fake socket in `src/api/testing/fakeWebSocket.ts` and fake timers): shotState with renamed states (`brewing`, `done`) plus machine frames entering and leaving `espresso` gives exactly one `started` and one `finished`; normal shotState frames still win, with no double events.

- [ ] **C6. Workflow PUT (5.13).** `WORKFLOW_TIMEOUT_MS = 35_000` in `client.ts`. In `workflow.ts` `activateProfile`: when `updateWorkflow` fails with code `timeout` or status 503, read the workflow back; if `findProfileMismatch` finds nothing and `context.extras.cafai` equals what was sent, return that workflow; otherwise rethrow the original error. Tests: timeout then a matching read counts; timeout then a different profile rethrows the timeout; a 400 is never reconciled.

- [ ] **C7. The probe (5.14)** is in wave 0's client; add the test that a 400 without "enjoyment" in it gives `null`.

- [ ] **Done when:** `npx vitest run src/api src/ui/machine` passes; `npx tsc -p tsconfig.json --noEmit` shows no errors in your files; `npm run lint` is clean for your files.

### Task D: mock (section 7)

**Files:** Modify `mock/decaid/**` (except `contract.test.ts`), `mock/fixtures/**` (new fixtures only; never edit an existing one), `mock/demo/seed.ts`, `mock/decaid/urlOptions.ts` and their tests.

- [ ] **D1. Settings:** `GET /api/v1/settings` gains `gatewayMode` (default `tracking`; `?mockGateway=full` starts in `full`), `POST /api/v1/settings` merges known keys and answers the settings.
- [ ] **D2. Enjoyment:** `PUT /api/v1/shots/{id}` with `enjoyment` outside 0-10 answers 400 `{"error":"Invalid request","message":"Invalid argument(s): enjoyment must be between 0 and 10"}` before the id lookup; `?mockEnjoyment=100` switches to 0.8.6 behaviour (no validation, unknown id 404 first).
- [ ] **D3. Plugins:** `GET /api/v1/plugins` lists `time-to-ready.reaplugin`, `visualizer.reaplugin`, `dye2.reaplugin`, `settings.reaplugin` with the manifest fields of `.ref/decaid/assets/plugins/*/manifest.json` and the load-state field Decaid's handler really sends (find it in `.ref/decaid/lib/src/services/webserver/`); `?mockPlugins=none` lists none loaded.
- [ ] **D4. Beans:** `GET/POST /api/v1/beans`, `GET/POST /api/v1/beans/{id}/batches`, `PUT /api/v1/beans/{id}` and `PUT /api/v1/bean-batches/{id}` (for archiving), with ids like Decaid's (read `beans_handler.dart`), persisted like the mock's other state (`mock/persist.ts`). Seed two beans with a batch each (one roasted 9 days before the mock's clock, one 30 days with 12 days frozen).
- [ ] **D5. Time-to-ready:** the channel `/ws/v1/plugins/time-to-ready.reaplugin/timeToReady` emits `{status:'heating', remainingTimeMs}` counting down after a wake from sleep, then `{status:'reached', remainingTimeMs:0}`; `insufficient_data` frames without an estimate in between (as the real plugin does early on).
- [ ] **D6. Visualizer:** after a shot is stored, the mock writes `visualizer.reaplugin`'s `lastUploadedShot` in the KV store about 4 s later, in the shape the real plugin writes (read `.ref/decaid/assets/plugins/visualizer.reaplugin/plugin.js`).
- [ ] **D7. DYE2:** `GET /api/v1/plugins/dye2.reaplugin/recent-favs` and the `dye2.reaplugin` KV keys (`autoFavourites`, `recipes`, `equipment`, `baskets`) in the shapes of `.ref/dye2/docs/KV_CONTRACT.md`, seeded with two setups for the first seeded bean.
- [ ] **D8. Skip step:** `PUT /api/v1/machine/state/skipStep` during a shot moves the shot player to the next profile step (its `profileFrame` advances); otherwise 200 and nothing.
- [ ] **D9. Workflow:** `steamSettings`, `hotWaterData`, `rinseData` are in the workflow and merge on PUT (check they already are); `?mockSlowWorkflow=<ms>` delays the PUT's answer, and `?mockSlowWorkflow=503` answers 503 after 30 s having applied the change (Decaid's hang, streamline's rule).
- [ ] **D10. KV:** the `cafai-key` namespace works like any other.
- [ ] **Done when:** `npx vitest run mock` passes with tests for D1-D10; `npm run build:mock` succeeds.

### Wave 1 integration (integrator)

- [ ] Run `npm run typecheck && npm run lint && npm test > "$TEMP/w1.log" 2>&1; echo exit=$?`. Expected: `exit=0`. Fix what the seams broke (most likely: the mock contract test against the mock's new routes; readers against fakes).
- [ ] Run `npm run build && npm run build:mock && npm run e2e > "$TEMP/w1e2e.log" 2>&1; echo exit=$?`. Expected: `exit=0` (the existing 188 pass; nothing new yet).
- [ ] One combined review of the wave (a fresh agent with the spec and the diff), fix trivia directly, then commit per task: `feat: Decaid contract: pinned v0.8.8 specs, generated types and checks in typecheck`, `test: CafAI against a real Decaid: test:decaid, the CI job and the release gate`, `fix: Decaid replies are read, not trusted: drift log, Stop for unknown states, no silent zeros`, `test: the mock serves settings, plugins, beans, time-to-ready, Visualizer and DYE2`.

---

## Wave 2 (three agents in parallel)

### Task E: engine (5.2, 5.4, 5.5, 5.10, 5.11, 5.12, 5.14 use, 6.1 data, loads and adding)

**Files:** Modify `src/app/engine/engine.ts`, `outbox.ts`, `ports.ts`, `uiMessages.ts`, `protocol.ts` (as needed), `src/app/adapters.ts`, `src/storage/index.ts`, `src/storage/mirror.ts`, `src/app/createServices.ts`, `src/ui/chat/CoachScreen.tsx` (the setup card's key text only), and their tests.

- [ ] **E1 (5.2).** Where a load clears another skin's grinder fields (`engine.ts` around the `context` it builds for an activation), clear `grinderBurrs: null` too. Test: an activation's context carries `grinderBurrs: null` when it clears the grinder.
- [ ] **E2 (6.1 loads).** The activation context writes `beanBatchId: bag.decaidBatchId ?? null`, `coffeeName: bag.name`, `coffeeRoaster: bag.roaster` instead of clearing them. Tests: a linked bag's load carries its batch; an unlinked bag's carries `null`.
- [ ] **E3 (6.1 adding).** After `save_bag_details` runs for a bag with no `decaidBatchId`: `listBeans()`, reuse a bean whose roaster and name match case-insensitively (trimmed), else `createBean({roaster, name, country: origin, processing: process, notes})` (keys with no value left out; skip entirely when the bag has no roaster or no name); then `createBatch(bean.id, {roastDate, roastLevel})` (only the known ones); store both ids on the bag; add the chat note "Added to Decaid's beans." In the background: never blocks the intake; a failure is retried at the next `save_bag_details`. Through the API port (`ports.ts`, `adapters.ts`). Tests: creates bean and batch and links them; reuses a matching bean; skips without a name; a failure leaves the bag unlinked and tries again next time; never calls a PUT or DELETE on beans.
- [ ] **E4 (5.14 use).** Stars become `enjoyment` through the probed scale: the engine asks `probeEnjoymentScale()` once per session (lazily, before the first enjoyment write) and writes `stars * 2` on 10 or `stars * 20` on 100; while the answer is `null`, the stars wait in the outbox and the probe is asked again at the next flush. Anything that reads `enjoyment` back divides by the same factor. Tests: both scales; a `null` probe holds the write; the probe runs once per session.
- [ ] **E5 (5.11).** `outbox.ts`: an item whose write fails with a GatewayError of status 400-499, other than 408, 409, 425 and 429, is dropped, reported (`reportDrift('PUT /api/v1/shots/{id}', '<what>: refused (HTTP <status>)')`) and announced once per item with "Decaid would not save the taste for this shot: <message>." (the stars, the grinder: their own words). A non-string `espressoNotes` is read as empty (`shotNotes.ts`) and reported. Tests: 400 drops with one notice; 409 and 503 retry; a TypeError never loops.
- [ ] **E6 (5.12).** When the barrier answers `unsupported`, the chat says once per session "This Decaid cannot confirm that the machine took a profile, so CafAI will assume it did." Test: one notice across two loads.
- [ ] **E7 (5.10).** A shot record without `workflow.profile` is credited as now, with `reportDrift('GET /api/v1/shots/{id}', 'workflow.profile: missing')` and the chat note "Decaid's record did not say which profile ran; CafAI counted it for v<N>." Test.
- [ ] **E8 (5.3, 5.4, 5.5).** `src/storage/index.ts`: `restoreFromMirrorIfEmpty` tells "unreachable" (a GatewayError `network`/`timeout`) from "unreadable" (`unexpected_reply`) from "nothing to restore". `createServices.ts`: when the boot restore was unreachable, retry in the background (2 s doubling to 30 s, for 10 minutes, and at once on machine connect and on `visibilitychange` to visible) until it lands or finds nothing; when records land: `coach.refresh()`, re-read the look (`appearance`), and the note "Your bags are back from Decaid's backup." Also at boot (and in the same retry): `storage.keyBackup.restoreIfMissing()`. The mirror gate (`mirror.ts`) treats a `getAll` throw as "do not push yet" and never as empty. The key re-entry text (5.5): when the boot restored bags and there is still no key, the setup card in `CoachScreen.tsx` says "Decaid was updated or this browser's storage was cleared. Your bags are back; paste your API key again." (the engine exposes `restoredFromBackup: boolean` in its state for it). Tests: unreachable then reachable restores and refreshes; unreadable never pushes; a restored key skips the prompt; the re-entry text shows only after a restore without a key.
- [ ] **Done when:** `npx vitest run src/app src/storage src/ui/chat/CoachScreen.test.tsx` passes; `npx tsc -p tsconfig.json --noEmit` shows no errors in your files.

### Task F: machine (5.1, 6.2, 6.3, 6.7)

**Files:** Create `src/ui/machine/useGatewayMode.ts`, `src/ui/machine/useScaleRevive.ts` (+ tests). Modify `src/ui/machine/MachineAlerts.tsx`, `StatsCard.tsx`, `ShotView.tsx`, `src/api/telemetry.ts` (the time-to-ready channel only), `src/api/types.ts` (`TelemetryState.timeToReady`), `src/ui/shell/AppShell.tsx` (mount the two hooks), and their tests.

- [ ] **F1 (5.1).** `useGatewayMode()`: reads `decaid.getSettings()` on mount, when the machine connects and when the page becomes visible; returns `{ mode, fixing, fix() }`; `fix()` calls `updateSettings({ gatewayMode: 'tracking' })` then re-reads. `MachineAlerts` shows, while `mode === 'full'`, the alert of spec 5.1 with the button **Let Decaid stop shots** (`TID.gatewayAlert`, `TID.gatewayFix`); a failed fix shows the error sentence in the alert. Tests: full shows the alert; the fix posts `tracking` and the alert goes; tracking and disabled show nothing; an unreadable settings reply shows nothing.
- [ ] **F2 (6.2).** The "not connected" alert gets **Connect** for the machine (`TID.connectMachine`) and the scale (`TID.connectScale`), each only when that one is missing: `decaid.connectKind(kind)`, "Looking for your DE1..." (or "...scale...") while it runs, `describeFailedConnect()` (`src/api/devices.ts`) when the device list after it still lacks the device; one at a time. `useScaleRevive()`: when the machine leaves `sleeping` or the page becomes visible, and no scale is connected though one was this session, one `connectKind('scale')` with `scanDevices({quick:true})` semantics, at most every 30 s, never while the machine state is `espresso`, `steam`, `hotWater` or `flush`. Tests for both, with fake timers.
- [ ] **F3 (6.3).** `telemetry.ts`: `watchTimeToReady(on: boolean)` opens or closes `/ws/v1/plugins/time-to-ready.reaplugin/timeToReady`, parses frames into `TimeToReadyFrame` (unknown status kept; a missing or non-numeric `remainingTimeMs` is `null`), and keeps `timeToReady` in the state, holding the last estimate while frames come without one. AppShell turns it on while `plugins.isLoaded(PLUGIN.timeToReady)`. `StatsCard` shows "Ready in about N min" (`Math.ceil(ms / 60000)`; under a minute "Ready in under a minute"; `TID.timeToReady`) while the status is `heating` with an estimate. Tests: the countdown shows, holds through an estimate-less frame, and goes on `reached`; nothing without the plugin.
- [ ] **F4 (6.7).** `ShotView`: **Next step** (`TID.nextStep`, a tonal button beside the step name) while the machine is in `espresso` and the loaded profile has a step after `profileFrame`; it sends `setMachineState('skipStep')` through the same one-command-at-a-time path as the row (`useMachineCommands`). Tests: shown mid-profile, hidden on the last step and outside espresso; the tap sends `skipStep`.
- [ ] **Done when:** `npx vitest run src/ui/machine src/ui/shell src/api/telemetry.test.ts` passes; no type errors in your files.

### Task G: settings (4.6, 5.6 switch, 5.15, 6.6)

**Files:** Create `src/ui/settings/AboutDecaid.tsx`, `src/ui/settings/DrinkSettingsSection.tsx`, `src/ui/settings/drinkSettings.ts` (+ tests). Modify `src/ui/settings/SettingsScreen.tsx` (+ test).

- [ ] **G1 (4.6, 5.15).** `AboutDecaid` in the About section (`TID.aboutDecaid`): "Decaid <running> (CafAI was verified with <VERIFIED_DECAID.release>)" (`src/api/decaidVersion.ts`, from task A); the "older" sentence of spec 4.6 when the running version's numeric part is lower; recorded drift as "Decaid sent N things CafAI did not expect" with the entries listed (`TID.driftReport`) and **Copy report** (`TID.copyDriftReport`) using `formatDriftReport` and `copyText` from `src/ui/history/exportFile.ts`; backup health (`TID.backupHealth`): "Backed up to Decaid N min ago" from `storage.mirror.lastPushAt`, "Backup paused: <lastError>" when set, "Not backed up yet" otherwise. Use `useSyncExternalStore` on `driftLog`. Tests: newer, older and unparseable versions; the drift list and the copied text; the three backup states.
- [ ] **G2 (5.6).** In the Coach section (beside the API key): the switch **Keep my API key in Decaid** (`TID.keyInDecaid`), off by default, with the sentence of spec 5.6 under it; its state from `storage.keyBackup.isOn()` (disabled with "Decaid can't be reached" when that throws); toggling calls `setOn`; saving or forgetting the key calls `keyBackup.keyChanged()`. Tests: off by default; on copies; off deletes; a changed key refreshes the copy.
- [ ] **G3 (6.6).** `DrinkSettingsSection` (`TID.drinkSettings`), "Steam, hot water and flush": steam temperature (°C), time (s), flow (ml/s); hot water temperature, volume (ml), time, flow; flush time, temperature, flow. Read from `decaid.getWorkflow()` (`steamSettings`, `hotWaterData`, `rinseData`); each change is clamped (`drinkSettings.ts`: ranges from Decaid's spec descriptions in `contract/decaid/spec/rest_v1.yml`; where the spec gives none, streamline's clamps in `docs/audit/2026-10-09/streamline.md`; integers where the spec says integer) and written with `updateWorkflow({ steamSettings: {...} })` (only the changed object, never the profile); controls are disabled with "Not while the machine is running" while the machine is in `espresso`, `steam`, `hotWater` or `flush`. Use the steppers and layout of the existing sections (`Section.tsx`, `GrinderFields.tsx`). Tests: values load; a change writes only that object, clamped; disabled while running; a failed write shows its sentence and reverts.
- [ ] **Done when:** `npx vitest run src/ui/settings` passes; no type errors in your files.

### Wave 2 integration (integrator)

- [ ] `npm run typecheck && npm run lint && npm test`, then `npm run build && npm run build:mock && npm run e2e`; all exit 0.
- [ ] One combined review; fixes; commits: `feat: the engine fails safe: refused writes stop, restores wait for Decaid, the rating scale is asked`, `feat: gateway mode alert, Connect, ready-in countdown and Next step`, `feat: Settings shows Decaid's version, drift and backup; key in Decaid; steam and hot water settings`.

---

## Wave 3 (one agent)

### Task H: intake (6.1 card and coach, 6.4, 6.5, 6.8)

**Files:** Create `src/ui/chat/parts/BeanCard.tsx`, `src/ui/chat/parts/BagConfirmCard.tsx`, `src/ui/chat/bagPhoto.ts` (+ tests), `src/coach/roastAge.ts` (+ test), `src/llm/extractBag.ts` (+ test). Modify `src/app/engine/engine.ts`, `src/app/types.ts`, `src/app/engine/ports.ts`, `src/app/adapters.ts`, `src/coach/contract.ts`, `src/coach/tools.ts`, `src/coach/prompt.ts`, `src/coach/queries.ts`, `src/ui/chat/ChatSurface.tsx`, `src/ui/chat/parts/types.ts`, `src/ui/chat/parts/ShotCard.tsx`, `src/ui/history/**`, `src/storage/types.ts` and `schema.ts` (the iteration's Visualizer link), `mock/anthropic/**`, `docs/briefs/ENGINE_PROTOCOL.md`, and their tests.

- [ ] **H1 (6.1 card).** A new UI message kind `beanPicker` with the batches (bean name, roaster, roast date, ids). The engine posts it first when a new bag starts (it reads `listBeans()` and each bean's `listBatches()`, unarchived, sorted and capped as spec 6.1 says; Decaid out of reach gives the card with only Photo and Something else). `coach.pickBean(batchId)` fills the bag (spec 6.1's mapping; a roast level matches CafAI's five case-insensitively, else `null`), links both ids, closes the card, and starts the intake turn with "The user picked <name> by <roaster> from Decaid's bean library: <details>." `coach.skipBeanPick()` closes it and starts today's intake. `BeanCard` (`TID.beanCard`, rows `TID.beanOption`, `TID.beanSomethingElse`, `TID.bagPhoto`) in the style of `TemplateCards.tsx`. Tests: card first; pick fills and links; skip runs today's intake; out of reach shows the short card; a reload rebuilds an open card from the transcript like other UI parts.
- [ ] **H2 (6.1 coach).** `save_bag_details` gains `roastDate` (`YYYY-MM-DD` or null; zod in `contract.ts`, description in `tools.ts`). `roastAge.ts`: `roastAgeDays(roastDate, today, batch?)`, minus the days between `freezeDate` and `unfreezeDate` (or today when not yet unfrozen); the prompt (`prompt.ts`) gives "Roasted <date> (<n> days ago; <m> days in the freezer not counted)" when known. Tests for both. The scripted coach sends `roastDate: null` (update `docs/briefs/ENGINE_PROTOCOL.md` and `mock/anthropic/script.ts`).
- [ ] **H3 (6.5).** The auto tool `get_recent_setups` (`contract.ts`, `tools.ts` with spec 6.5's description, `queries.ts`): when `plugins.isLoaded(PLUGIN.dye2)`, `getPluginEndpoint('dye2.reaplugin', 'recent-favs')`, else the KV keys; filtered to the bag's batch (or name and roaster); each setup as `{profileTitle, grindSetting, doseG, yieldG, rpm, basket, date}`; plus `equipment` and `baskets` names; `{"available": false}` without DYE2. Read-only. Tests: plugin path; KV path with a non-array value read as empty; absent.
- [ ] **H4 (6.4).** After a shot card lands, when `plugins.isLoaded(PLUGIN.visualizer)`: read `visualizer.reaplugin`'s `lastUploadedShot` every 3 s for up to 30 s; when it names this shot, store the Visualizer URL on the iteration (`visualizerUrl?: string | null`, schema optional) and show **On Visualizer** (`TID.visualizerLink`, a plain `<a href>`) on the shot card and in History. Tests: the link appears; no link after 30 s without a match; nothing without the plugin.
- [ ] **H5 (6.8).** `bagPhoto.ts`: from a `File`, draw into a canvas at most 1568 px on its longest side, `toBlob('image/jpeg', 0.85)`, base64. `extractBag.ts`: one non-streaming call through the existing Anthropic client (`src/llm/anthropic.ts`) with an `ImageBlock` and a short instruction to answer JSON `{name, roaster, origin, process, roastLevel, roastDate, notes}` (each null when not on the bag), parsed with zod. The Photo button (`TID.bagPhoto`) on the bean card opens a hidden `<input type="file" accept="image/*" capture="environment">` (`TID.bagPhotoInput`); the answer fills `BagConfirmCard` (`TID.bagConfirm`), editable; Confirm saves like `save_bag_details` (and E3 links or adds the bean) and starts the intake turn with the details. Without a key: "Add your API key in Settings first." Never stored: no field of the bag, iteration or transcript holds the image. The scripted coach answers the extraction call with a canned bag (`mock/anthropic`). Update the ESLint ban message for `getUserMedia` in `eslint.config.js` to "Decaid asks per skin; CafAI uses <input type=file capture>." (tell the integrator; the file is not yours). Tests: downscale size; parse of a good and a bad answer; the card flow with a fixture image in jsdom; no image in storage after Confirm.
- [ ] **Done when:** `npx vitest run src/coach src/app src/ui/chat src/ui/history src/llm mock/anthropic` passes; `npx tsc -p tsconfig.json --noEmit` is clean.

### Wave 3 integration (integrator)

- [ ] The full chain as before; one combined review; commit `feat: bags from Decaid's bean library or a photo; the coach reads DYE2; Visualizer links`.

---

## Wave 4

### Task I: e2e and the Chromium 91 loop

**Files:** Create `e2e/decaid-features.spec.ts`, `e2e/decaid-safety.spec.ts`; modify `e2e/helpers.ts`, `tools/chrome91/loop.mjs`.

- [ ] Specs (on all five projects unless a check is tablet-only, as the suite does): the bean card (pick a seeded bean: the bag's details fill and the next load's request carries its `beanBatchId`; Something else gives today's intake); the bag photo with a fixture image (`e2e/fixtures/bag.jpg`, small) through the scripted coach; the gateway alert with `?mockGateway=full` and its fix; Connect after a mock disconnect; the ready-in line after Sleep then Wake; Next step mid-shot (the step name changes); the steam settings change reaching the mock's workflow; the key switch; About's versions, and the drift report after a `?mockDrift=1` mock option that renames one machine reading (add the option to the mock in this task if task D did not); `?mockEnjoyment=100` writing stars x 20. Remember `playwright-stale-last`: wait for the new card before tapping `.last()`.
- [ ] Chromium 91 loop: the bean card appears and Something else continues the loop as before.
- [ ] **Done when:** `npm run e2e` passes in full; `npm run build:mock && npm run smoke:chrome91 && npm run smoke:chrome91:loop` passes.

### Task J: docs

- [ ] `DECISIONS.md`: a section "Decaid alignment and update safety (2026-10-09)" with D93-D104 as in the spec's section 3, each in the file's prose style with the why.
- [ ] `README.md`: the Privacy section (the key may be kept in Decaid when the user turns it on; bag photos go to Anthropic once and are not kept); Develop (`decaid:update`, `decaid:watch`, `test:decaid`, `e2e:real`); the features in "How the coach works" and "Screens and looks".
- [ ] `DESIGN.md`: the new cards and controls. `docs/HARDWARE_TEST_PLAN.md`: the soft keyboard check (5.17), the camera consent on a tablet, `test:decaid` read-only against the tablet, the rating scale on the tablet's Decaid. `MORNING.md`: what was built, what is unverified (the Linux CI path until the repo is on GitHub), what to look at first.

### Task K: verification (integrator)

- [ ] `npm run verify` (typecheck with the contract, lint, unit tests, build, zip, e2e): exit 0.
- [ ] `npm run decaid:watch`: exit 0, report saved to `$TEMP`.
- [ ] `test:decaid` against the owner's Windows simulator (docs/SIMULATOR.md), with writes and the simulated shot, if the simulator is installed and the owner agrees to it being started; otherwise say so in MORNING.md.
- [ ] A fresh-eyes review (a new agent with the spec, the audit and the diff; brief like `docs/briefs/verify-chat-first.md`); fix what it finds.
- [ ] Commit the docs and fixes; update the session tags.

---

## Self-review

- **Spec coverage.** 4.1 (A1-A4), 4.2 (A6, A7), 4.3 (A8, A9), 4.4 (B1-B8), 4.5 (0.2, C1), 4.6 (A1, G1), 4.7 (B9), 4.8 (A10); 5.1 (F1), 5.2 (E1), 5.3 (C2, E8), 5.4 (E8), 5.5 (E8), 5.6 (0.4, G2, E8), 5.7 (C4), 5.8 (C3), 5.9 (C5), 5.10 (E7), 5.11 (E5), 5.12 (E6), 5.13 (C6), 5.14 (0.3, C7, E4), 5.15 (G1), 5.16 (already in place), 5.17 (J); 6.1 (0.4, E2, E3, H1, H2), 6.2 (F2), 6.3 (D5, F3), 6.4 (D6, H4), 6.5 (D7, H3), 6.6 (G3), 6.7 (D8, F4), 6.8 (H5); section 7 (D, I, K).
- **Names used across tasks:** `reportDrift`, `driftLog`, `formatDriftReport` (0.2); `PluginDirectory`, `PLUGIN`, `createPluginDirectory` (0.4); `KeyBackup` and its four methods (0.4); `probeEnjoymentScale`, `listBeans`, `listBatches`, `createBean`, `createBatch`, `listPlugins`, `getPluginEndpoint`, `updateSettings`, `connectKind` (0.3); `SpecValidator`, `loadSpecValidator` (A6, used in B); `VERIFIED_DECAID` (A1, used in G1); `MachineFrame`, `MachineReading` (C3); `isStoppableMachineState` (C4); `TimeToReadyFrame`, `watchTimeToReady` (0.3, F3); `restoredFromBackup` (E8).
