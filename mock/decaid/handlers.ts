/**
 * MSW REST handlers for the mock Decaid.
 *
 * Every pattern is `*:8080/api/v1/...`: any host, but only Decaid's port, so
 * the handlers never catch Anthropic or the app's own origin. Status codes
 * and bodies follow the gateway source (200 `null` for state changes and
 * tare, 500 `{error:"DeviceNotConnectedException: ..."}` without a machine,
 * 400 `{error, message}` for bad input, KV misses as 200 `null`, ETags with
 * 304 on the conditional routes). Unknown routes on :8080 answer shelf's
 * plain-text 404 (see `decaidFallbackHandlers`).
 *
 * Machine writes queue behind each other as on Decaid's DE1 write queue
 * (machine.ts): POST /machine/profile and every state request but idle wait
 * for a profile upload in flight. The grinder routes follow
 * grinders_handler.dart (grinders.ts).
 */
import { http, HttpResponse, type HttpHandler } from 'msw';
import type { MachineStateName } from '../../src/api/types.ts';
import { fixtures } from '../fixtures/index.ts';
import { MockHttpError } from './errors.ts';
import { isPlainObject } from './json.ts';
import { PLUGIN_IDS } from './plugins.ts';
import { sha256Hex } from './sha256.ts';
import type { ShotPlayer } from './shotPlayer.ts';
import type { MockDecaid } from './state.ts';

/** workflow_handler.dart's queueWaitTimeout (aab5f93, decaid#634, D9). */
const WORKFLOW_HANG_MS = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Any host, Decaid's port. */
export const DECAID_ORIGIN_PATTERN = '*:8080';

/** dev/machine.dart MachineState values; anything else is a 500 from byName. */
export const MACHINE_STATES: readonly MachineStateName[] = [
  'booting',
  'busy',
  'idle',
  'schedIdle',
  'sleeping',
  'heating',
  'preheating',
  'espresso',
  'hotWater',
  'flush',
  'steam',
  'steamRinse',
  'skipStep',
  'cleaning',
  'descaling',
  'calibration',
  'selfTest',
  'airPurge',
  'needsWater',
  'error',
  'fwUpgrade',
];

type Method = 'get' | 'post' | 'put' | 'delete';

interface RouteContext {
  request: Request;
  url: URL;
  params: Record<string, string>;
  /** The raw request body text ('' when there is none). */
  bodyText: string;
}

type Resolver = (context: RouteContext) => Response | Promise<Response>;

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return HttpResponse.json(body as never, { status, headers });
}

function plain(text: string, status: number): Response {
  return new HttpResponse(text, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

function errorResponse(error: MockHttpError): Response {
  if (error.body === null) return plain(error.plainText ?? '', error.status);
  return json(error.body, error.status, error.headers);
}

/** jsonOkConditional: a strong ETag over the body; If-None-Match (or *) gives 304. */
function conditional(request: Request, body: unknown): Response {
  const text = JSON.stringify(body);
  const etag = `"${sha256Hex(text).slice(0, 16)}"`;
  const ifNoneMatch = request.headers.get('If-None-Match')?.trim();
  if (ifNoneMatch && (ifNoneMatch === '*' || ifNoneMatch === etag)) {
    return new HttpResponse(null, { status: 304, headers: { ETag: etag } });
  }
  return new HttpResponse(text, { status: 200, headers: { 'Content-Type': 'application/json', ETag: etag } });
}

function parseBody(text: string): unknown {
  return text.trim() ? (JSON.parse(text) as unknown) : null;
}

/** Decaid's FormatException text for a body jsonDecode cannot read. */
function invalidJson(text: string): string {
  if (!text.trim()) return 'FormatException: Unexpected end of input (at character 1)';
  return `FormatException: Unexpected character (at character 1)\n${text.slice(0, 40)}`;
}

/** GrindersHandler runs every body through jsonDecode, so an empty one is a FormatException too. */
function parseGrinderBody(text: string): unknown {
  if (!text.trim()) throw new SyntaxError('empty body');
  return JSON.parse(text) as unknown;
}

/** The raw path segments after /api/v1/store (Decaid never decodes them). */
function rawStoreSegments(url: URL): string[] {
  return url.pathname.split('/').slice(4);
}

export function decaidHttpHandlers(state: MockDecaid, player: ShotPlayer): HttpHandler[] {
  function route(method: Method, path: string, resolve: Resolver): HttpHandler {
    return http[method](`${DECAID_ORIGIN_PATTERN}/api/v1${path}`, async ({ request, params }) => {
      const url = new URL(request.url);
      const bodyText = method === 'post' || method === 'put' ? await request.text() : '';
      let loggedBody: unknown;
      try {
        loggedBody = parseBody(bodyText);
      } catch {
        loggedBody = bodyText;
      }
      state.logRequest({ method: request.method, path: url.pathname, query: url.search, body: loggedBody });

      const fault = state.takeFault(request.method, url.pathname);
      if (fault) {
        if (fault.plainText !== undefined) return plain(fault.plainText, fault.status);
        return json(fault.body ?? null, fault.status, fault.headers ?? {});
      }

      try {
        return await resolve({ request, url, params: params as Record<string, string>, bodyText });
      } catch (error) {
        if (error instanceof MockHttpError) return errorResponse(error);
        return json({ error: 'Internal server error', message: String(error) }, 500);
      }
    });
  }

  function requireMachine(): void {
    if (!state.isMachineConnected()) throw new MockHttpError(500, fixtures.errorMachineNotConnected() as Record<string, unknown>);
  }

  function shotActive(): boolean {
    const current = state.getShotState().state;
    return current !== 'idle' && current !== 'finished';
  }

  return [
    // ---- info and settings ---------------------------------------------------------
    route('get', '/info', () => json(fixtures.buildInfo())),
    route('get', '/settings', () => json(state.getSettings())),
    route('post', '/settings', ({ bodyText }) => {
      let body: unknown;
      try {
        body = parseBody(bodyText);
      } catch {
        // jsonDecode throws outside any handler try/catch: shelf's plain 500.
        return plain('Internal Server Error', 500);
      }
      state.applySettingsPatch(body);
      return json(null);
    }),

    // ---- plugins ---------------------------------------------------------------------
    route('get', '/plugins', () => json(state.listPlugins())),
    route('get', '/plugins/:id/:endpoint', ({ params }) => {
      const pluginId = params.id ?? '';
      const endpoint = params.endpoint ?? '';
      if (!state.isPluginLoaded(pluginId)) return json({ error: `plugin with ${pluginId} not loaded` }, 404);
      if (pluginId === PLUGIN_IDS.dye2 && endpoint === 'recent-favs') {
        const favourites = state.kvGet(PLUGIN_IDS.dye2, 'autoFavourites');
        return json(Array.isArray(favourites) ? favourites : []);
      }
      return json({ error: `endpoint ${endpoint} not available` }, 404);
    }),

    // ---- machine -----------------------------------------------------------------------
    route('get', '/machine/info', () => json(state.getMachineInfo())),
    route('get', '/machine/state', () => {
      requireMachine();
      return json(state.getMachineSnapshot());
    }),
    route('put', '/machine/state/:newState', async ({ params }) => {
      requireMachine();
      const name = params.newState ?? '';
      if (!(MACHINE_STATES as readonly string[]).includes(name)) {
        throw new MockHttpError(500, {
          error: `Invalid argument (name): No enum value with that name: "${name}"`,
          st: '#0      EnumByName.byName (dart:core/enum.dart)\n#1      De1Handler._requestStateHandler',
        });
      }
      const settings = state.getSettings();
      if (
        name === 'espresso' &&
        settings.blockOnNoScale === true &&
        !state.isScaleConnected() &&
        state.getWorkflow().profile.beverage_type !== 'cleaning'
      ) {
        return json(fixtures.errorBlockNoScale(), 400);
      }
      state.machineCommands.push(name);
      if (name === 'idle') {
        // Decaid stops at once, outside the write queue (De1Controller.requestMachineState).
        player.command(name);
        return json(null);
      }
      // Every other request queues behind earlier machine writes, an upload in flight included.
      await state.runMachineWrite(() => {
        requireMachine();
        player.command(name);
      });
      return json(null);
    }),
    route('post', '/machine/profile', async ({ bodyText }) => {
      if (!state.machineProfileRoute) return plain('Route not found', 404);
      requireMachine();
      let body: unknown;
      try {
        body = JSON.parse(bodyText) as unknown;
      } catch {
        return json({ error: 'Invalid JSON body' }, 400);
      }
      if (!isPlainObject(body)) return json({ error: 'Invalid JSON body' }, 400);
      await state.loadMachineProfile(body);
      return json(null);
    }),
    route('get', '/machine/capabilities', () => json({ capabilities: state.getCapabilities() })),
    route('post', '/machine/heartbeat', () => json(state.heartbeat())),

    // ---- scale ---------------------------------------------------------------------------
    route('get', '/scale/info', () => {
      if (!state.isScaleConnected()) return json({ error: 'No scale connected' }, 503);
      return json({ batteryLevel: state.getScaleSnapshot()?.battery ?? 87 });
    }),
    route('put', '/scale/tare', () => {
      const settings = state.getSettings();
      if (settings.blockTareDuringShot === true && shotActive() && settings.gatewayMode !== 'full') {
        return json({ details: 'Tare blocked: a shot is in progress', type: 'block_tare_during_shot' }, 400);
      }
      if (!state.isScaleConnected()) return json({ error: 'DeviceNotConnectedException: scale not connected' }, 500);
      player.tare();
      return json(null);
    }),

    // ---- devices -------------------------------------------------------------------------
    route('get', '/devices', () => json(state.getDevices())),
    // Decaid reads each flag's first value: quick only when "true", connect unless "false".
    route('get', '/devices/scan', ({ url }) =>
      json(state.scanDevices({ quick: url.searchParams.get('quick') === 'true', connect: url.searchParams.get('connect') !== 'false' })),
    ),
    route('put', '/devices/connect', ({ bodyText }) => {
      let body: unknown;
      try {
        body = parseBody(bodyText);
      } catch {
        return json({ error: 'Invalid JSON' }, 400);
      }
      return json(state.connectDevice(body));
    }),

    // ---- workflow -------------------------------------------------------------------------
    route('get', '/workflow', () => json(state.getWorkflow())),
    route('put', '/workflow', async ({ bodyText }) => {
      if (state.slowWorkflowTimeout) {
        // workflow_handler.dart (aab5f93): a request waits behind
        // _workflowQueue, and a 30 s Timer marks it `expired` and completes
        // the 503 itself. The queued operation checks `if (expired) return;`
        // BEFORE it ever reads or applies the body, so an expired request
        // never parses, validates or merges anything.
        await sleep(WORKFLOW_HANG_MS);
        return json({ error: 'Workflow request queue timed out' }, 503);
      }
      let body: unknown;
      try {
        body = parseBody(bodyText);
      } catch {
        return json({ error: 'Invalid request', message: invalidJson(bodyText) }, 400);
      }
      const updated = state.updateWorkflow(body);
      if (state.slowWorkflowMs !== null) await sleep(state.slowWorkflowMs);
      return json(updated);
    }),

    // ---- profiles (specific routes before :id) ---------------------------------------------
    route('get', '/profiles', ({ request, url }) =>
      conditional(
        request,
        state.listProfiles({
          visibility: url.searchParams.get('visibility'),
          includeHidden: url.searchParams.get('includeHidden'),
          parentId: url.searchParams.get('parentId'),
        }),
      ),
    ),
    route('get', '/profiles/defaults', () => json(state.defaultProfiles())),
    route('post', '/profiles/restore/:filename', ({ params }) => json(state.restoreDefaultProfile(params.filename ?? ''))),
    route('get', '/profiles/:id/lineage', ({ params }) => json(state.profileLineage(params.id ?? ''))),
    route('put', '/profiles/:id/visibility', ({ params, bodyText }) => {
      let body: unknown;
      try {
        body = parseBody(bodyText);
      } catch {
        return json({ error: 'Internal server error', message: invalidJson(bodyText) }, 500);
      }
      return json(state.setProfileVisibility(params.id ?? '', body));
    }),
    route('get', '/profiles/:id', ({ params }) => json(state.getProfile(params.id ?? ''))),
    route('post', '/profiles', ({ bodyText }) => {
      let body: unknown;
      try {
        body = parseBody(bodyText);
      } catch {
        return json({ error: 'Invalid request', message: invalidJson(bodyText) }, 400);
      }
      return json(state.createProfile(body), 201);
    }),
    route('put', '/profiles/:id', ({ params, bodyText }) => {
      let body: unknown;
      try {
        body = parseBody(bodyText);
      } catch {
        return json({ error: 'Invalid request', message: invalidJson(bodyText) }, 400);
      }
      return json(state.updateProfile(params.id ?? '', body));
    }),
    route('delete', '/profiles/:id', ({ params }) => json(state.deleteProfile(params.id ?? ''))),

    // ---- shots (specific routes before :id) ------------------------------------------------
    route('get', '/shots', ({ request, url }) => {
      const page = state.listShots(url.searchParams);
      return Array.isArray(page) ? json(page) : conditional(request, page);
    }),
    route('get', '/shots/latest', () => json(state.getLatestShot())),
    route('get', '/shots/ids', () => json(state.getShotIds())),
    route('get', '/shots/:id', ({ params }) => json(state.getShot(params.id ?? ''))),
    route('put', '/shots/:id', ({ params, bodyText }) => {
      let body: unknown;
      try {
        body = parseBody(bodyText);
      } catch {
        return json({ error: invalidJson(bodyText) }, 500);
      }
      return json(state.updateShot(params.id ?? '', body));
    }),
    route('delete', '/shots/:id', ({ params }) => json(state.deleteShot(params.id ?? ''))),

    // ---- grinder library -------------------------------------------------------------------
    route('get', '/grinders', ({ request, url }) =>
      conditional(request, state.listGrinders({ includeArchived: url.searchParams.get('includeArchived') })),
    ),
    route('get', '/grinders/:id', ({ params }) => json(state.getGrinder(params.id ?? ''))),
    route('post', '/grinders', ({ bodyText }) => {
      let body: unknown;
      try {
        body = parseGrinderBody(bodyText);
      } catch {
        return json({ error: invalidJson(bodyText) }, 400);
      }
      return json(state.createGrinder(body), 201);
    }),
    route('put', '/grinders/:id', ({ params, bodyText }) => {
      const id = params.id ?? '';
      // Decaid looks the grinder up before it reads the body.
      state.getGrinder(id);
      let body: unknown;
      try {
        body = parseGrinderBody(bodyText);
      } catch {
        return json({ error: invalidJson(bodyText) }, 400);
      }
      return json(state.updateGrinder(id, body));
    }),
    route('delete', '/grinders/:id', ({ params }) => json(state.deleteGrinder(params.id ?? ''))),

    // ---- beans library (specific routes before :id) ----------------------------------------
    route('get', '/beans', ({ request, url }) => conditional(request, state.listBeans({ includeArchived: url.searchParams.get('includeArchived') }))),
    route('post', '/beans', ({ bodyText }) => {
      let body: unknown;
      try {
        body = parseBody(bodyText);
      } catch {
        return json({ error: invalidJson(bodyText) }, 400);
      }
      return json(state.createBean(body), 201);
    }),
    route('get', '/beans/:id', ({ params }) => json(state.getBean(params.id ?? ''))),
    route('put', '/beans/:id', ({ params, bodyText }) => {
      const id = params.id ?? '';
      // beans_handler.dart checks the bean exists before it reads the body.
      state.getBean(id);
      let body: unknown;
      try {
        body = parseBody(bodyText);
      } catch {
        return json({ error: invalidJson(bodyText) }, 400);
      }
      return json(state.updateBean(id, body));
    }),
    route('get', '/beans/:beanId/batches', ({ request, url, params }) =>
      conditional(request, state.listBatches({ beanId: params.beanId ?? '', includeArchived: url.searchParams.get('includeArchived') })),
    ),
    route('post', '/beans/:beanId/batches', ({ params, bodyText }) => {
      let body: unknown;
      try {
        body = parseBody(bodyText);
      } catch {
        return json({ error: invalidJson(bodyText) }, 400);
      }
      return json(state.createBatch(params.beanId ?? '', body), 201);
    }),
    route('get', '/bean-batches', ({ request, url }) => conditional(request, state.listBatches({ includeArchived: url.searchParams.get('includeArchived') }))),
    route('get', '/bean-batches/:id', ({ params }) => json(state.getBatch(params.id ?? ''))),
    route('put', '/bean-batches/:id', ({ params, bodyText }) => {
      const id = params.id ?? '';
      state.getBatch(id);
      let body: unknown;
      try {
        body = parseBody(bodyText);
      } catch {
        return json({ error: invalidJson(bodyText) }, 400);
      }
      return json(state.updateBatch(id, body));
    }),

    // ---- key-value store (raw namespace and key) -------------------------------------------
    route('get', '/store/:namespace', ({ request, url }) => {
      const [namespace = ''] = rawStoreSegments(url);
      if (url.searchParams.get('full') === '1') return conditional(request, state.kvAll(namespace));
      return json(state.kvKeys(namespace));
    }),
    route('get', '/store/:namespace/:key', ({ url }) => {
      const [namespace = '', key = ''] = rawStoreSegments(url);
      return json(state.kvGet(namespace, key));
    }),
    route('post', '/store/:namespace/:key', ({ url, bodyText }) => {
      const [namespace = '', key = ''] = rawStoreSegments(url);
      state.kvSet(namespace, key, bodyText);
      return json({});
    }),
    route('delete', '/store/:namespace/:key', ({ url }) => {
      const [namespace = '', key = ''] = rawStoreSegments(url);
      state.kvDelete(namespace, key);
      return json({});
    }),
  ];
}

/** shelf's plain-text 404 for any other route on Decaid's port. Register last. */
export function decaidFallbackHandlers(): HttpHandler[] {
  return [http.all(`${DECAID_ORIGIN_PATTERN}/api/*`, () => plain('Route not found', 404))];
}
