// @vitest-environment jsdom
/**
 * The inline engine check in index.html, run the way an old tablet would meet
 * it: extracted from the real file and executed in a sandbox (Node's vm) whose
 * window is under the test's control. jsdom supplies the document; the
 * sandbox supplies the user agent, the Function constructor (to play an engine
 * that cannot parse the probe), storage, location and the timers.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { Linter } from 'eslint';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detectHost } from '../../api/host.ts';
import { BOOT_COLORS_KEY, bootColors } from '../appearance.ts';
import { buildPalette, namedTint } from '../palette.ts';

const INDEX_HTML = readFileSync(join(import.meta.dirname, '..', '..', '..', 'index.html'), 'utf8');

const UA = {
  chrome85: 'Mozilla/5.0 (Linux; Android 10; P80X Build/QP1A.190711.020; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/85.0.4183.127 Safari/537.36',
  chrome91: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/91.0.4469.0 Safari/537.36',
  chrome120: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  iosSafari: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  /** Decaid's WebView replaces the whole user agent (docs/verified/01-platform.md section 10). */
  decaid: 'Decent',
} as const;

/** How long the app gets to render before the watchdog gives up on it. */
const WATCHDOG_MS = 15000;
const SETTINGS_PATH = ':8080/api/v1/plugins/settings.reaplugin/ui?backName=CafAI';

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

/** The classic inline script(s) in index.html (module scripts excluded). */
function inlineScripts(): HTMLScriptElement[] {
  return [...parse(INDEX_HTML).querySelectorAll('script')].filter((s) => !s.src && s.type !== 'module');
}

function engineScript(): string {
  const [script] = inlineScripts();
  if (!script) throw new Error('index.html has no inline engine check');
  return script.textContent ?? '';
}

/** A Function constructor for an engine that cannot parse the probe (older than Chromium 91). */
function FunctionWithoutBrandChecks(): never {
  throw new SyntaxError("Unexpected token '#'");
}

interface Sandbox {
  userAgent?: string;
  brands?: Array<{ brand: string; version: string }>;
  hostname?: string;
  reaHostname?: string | null;
  /** What storage holds under the app's boot colours key (src/ui/appearance.ts), as stored. */
  savedColors?: string;
  storageThrows?: boolean;
  insideDecaid?: boolean;
  decentApp?: { exitToDashboard?: unknown };
  /** Replaces the sandbox's Function constructor. */
  functionCtor?: unknown;
  /** Run like a page whose content security policy forbids eval (new Function throws EvalError). */
  noEval?: boolean;
}

type Listener = (event: unknown) => void;

function run(options: Sandbox = {}) {
  const document = parse(INDEX_HTML);
  // Window 'error' listeners by phase, as the DOM keeps them: a resource that
  // fails to load fires a non-bubbling error at its element, which reaches
  // window only in the capture phase.
  const listeners = { capture: new Set<Listener>(), bubble: new Set<Listener>() };
  const phase = (options: unknown) =>
    options === true || (typeof options === 'object' && options !== null && (options as { capture?: unknown }).capture === true)
      ? listeners.capture
      : listeners.bubble;
  // A listener removed during dispatch is not called (DOM semantics).
  const dispatch = (set: Set<Listener>, event: unknown) => {
    for (const listener of [...set]) if (set.has(listener)) listener(event);
  };
  const console = { info: vi.fn(), log: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const assign = vi.fn();
  const navigator: Record<string, unknown> = { userAgent: options.userAgent ?? UA.chrome120 };
  if (options.brands) navigator.userAgentData = { brands: options.brands, mobile: false, platform: 'Android' };
  const global: Record<string, unknown> = {
    document,
    navigator,
    console,
    location: { protocol: 'http:', hostname: options.hostname ?? 'localhost', assign },
    localStorage: {
      getItem(key: string) {
        if (options.storageThrows) throw new Error('SecurityError');
        if (key === BOOT_COLORS_KEY) return options.savedColors ?? null;
        return key === 'reaHostname' ? (options.reaHostname ?? null) : null;
      },
    },
    // Resolved at call time, so vi.useFakeTimers() drives the script's timers.
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
    clearInterval: (id: ReturnType<typeof setInterval>) => clearInterval(id),
    addEventListener(type: string, listener: Listener, options?: unknown) {
      if (type === 'error') phase(options).add(listener);
    },
    removeEventListener(type: string, listener: Listener, options?: unknown) {
      if (type === 'error') phase(options).delete(listener);
    },
  };
  if (options.insideDecaid) global.__DECENT_HOST__ = { app: 'decent.app', platform: 'android', version: '0.9.0' };
  if (options.decentApp) global.decentApp = options.decentApp;
  if (options.functionCtor) global.Function = options.functionCtor;
  global.window = global;
  const before = new Set(Object.keys(global));

  const context = vm.createContext(global, options.noEval ? { codeGeneration: { strings: false, wasm: false } } : undefined);
  vm.runInContext(engineScript(), context);

  const root = () => document.getElementById('root')!;
  /** An uncaught error reported at window: capture listeners at target first, then the others. */
  const fireWindowError = (event: { error: Error | null; message: string }) => {
    const dispatched = { type: 'error', target: global, ...event };
    dispatch(listeners.capture, dispatched);
    dispatch(listeners.bubble, dispatched);
  };
  return {
    global,
    document,
    console,
    assign,
    listeners,
    listenerCount: () => listeners.capture.size + listeners.bubble.size,
    added: Object.keys(global).filter((key) => !before.has(key)),
    engine: global.__CAFAI_ENGINE__,
    fireWindowError,
    /** What an uncaught error looks like to the script. */
    fireError(error: Error, message = `Uncaught ${error.name}: ${error.message}`) {
      fireWindowError({ error, message });
    },
    /** A resource that failed to load: a non-bubbling error at its element. */
    fireLoadError(element: Element) {
      dispatch(listeners.capture, { type: 'error', target: element });
    },
    /** The app's own module script in index.html (the bundle's entry in a build). */
    appScript: () => document.querySelector('script[type="module"]')!,
    /** Another element in <head>, e.g. a stylesheet or a preload. */
    headElement(tag: string, attributes: Record<string, string>) {
      const node = document.createElement(tag);
      for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
      document.head.appendChild(node);
      return node;
    },
    /** The app's first render (main.tsx puts "Starting CafAI…" into #root). */
    appRenders() {
      const node = document.createElement('div');
      node.textContent = 'Starting CafAI…';
      root().appendChild(node);
    },
    fallback: () => document.querySelector<HTMLElement>('[data-cafai-start-failed]'),
    /** Why the fallback showed: 'syntax', 'load' or 'timeout'. */
    cause: () => document.querySelector('[data-cafai-start-failed]')?.getAttribute('data-cafai-start-failed') ?? null,
    /** The fallback's message paragraphs, in order. */
    messages: () => [...document.querySelectorAll('[data-cafai-start-failed] p')].map((p) => p.textContent),
    exitButton: () => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Exit to Decaid') ?? null,
    settingsLink: () => [...document.querySelectorAll('a')].find((a) => a.textContent === 'Decaid settings') ?? null,
    /** The colours the fallback and its two controls are drawn in. */
    look() {
      const fallback = document.querySelector<HTMLElement>('[data-cafai-start-failed]')!;
      const controls = [...fallback.querySelectorAll<HTMLElement>('button, a')];
      return {
        background: fallback.style.backgroundColor,
        ink: fallback.style.color,
        controls: controls.map((control) => ({ ink: control.style.color, line: control.style.borderColor })),
      };
    },
  };
}

/** A colour as an element's style reads it back (jsdom gives hex as rgb()). */
function cssColor(color: string): string {
  const probe = document.createElement('p');
  probe.style.color = color;
  return probe.style.color;
}

/** What look() reports for a page drawn in these colours. */
function lookOf(colors: { background: string; ink: string; line: string }) {
  const control = { ink: cssColor(colors.ink), line: cssColor(colors.line) };
  return { background: cssColor(colors.background), ink: cssColor(colors.ink), controls: [control, control] };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('index.html', () => {
  it('has one classic inline script, before the untouched module script', () => {
    expect(inlineScripts()).toHaveLength(1);
    expect(INDEX_HTML).toContain('<script type="module" src="./src/main.tsx"></script>');
    expect(INDEX_HTML.indexOf('<script>')).toBeGreaterThan(INDEX_HTML.indexOf('<div id="root"></div>'));
    expect(INDEX_HTML.indexOf('<script>')).toBeLessThan(INDEX_HTML.indexOf('<script type="module"'));
  });

  it('the inline script is plain ES5, so an engine too old for the bundle still runs it', () => {
    const linter = new Linter();
    const problems = linter.verify(engineScript(), { languageOptions: { ecmaVersion: 5, sourceType: 'script' } });
    expect(problems.map((p) => `${p.line}:${p.column} ${p.message}`)).toEqual([]);
  });

  it('adds nothing to window but __CAFAI_ENGINE__', () => {
    expect(run().added).toEqual(['__CAFAI_ENGINE__']);
  });
});

describe('engine check: the version, when the engine names one', () => {
  it('Chromium 85 is older than the floor, decided by the version alone', () => {
    const constructed = vi.fn();
    const { engine } = run({ userAgent: UA.chrome85, functionCtor: constructed });
    expect(engine).toEqual({ chromium: 85, supported: false, reason: 'version' });
    expect(constructed).not.toHaveBeenCalled();
  });

  it('Chromium 91 and 120 are supported (the probe confirms)', () => {
    expect(run({ userAgent: UA.chrome91 }).engine).toEqual({ chromium: 91, supported: true, reason: 'probe' });
    expect(run({ userAgent: UA.chrome120 }).engine).toEqual({ chromium: 120, supported: true, reason: 'probe' });
  });

  it('prefers the client-hint brands to the user agent string', () => {
    const brands = [
      { brand: 'Not.A/Brand', version: '99' },
      { brand: 'Chromium', version: '89' },
    ];
    expect(run({ userAgent: UA.decaid, brands }).engine).toEqual({ chromium: 89, supported: false, reason: 'version' });
    expect(run({ userAgent: UA.chrome85, brands: [{ brand: 'Google Chrome', version: '120' }] }).engine).toEqual({
      chromium: 120,
      supported: true,
      reason: 'probe',
    });
  });

  it('falls back to the user agent when the brands name no Chromium', () => {
    expect(run({ userAgent: UA.chrome85, brands: [] }).engine).toEqual({ chromium: 85, supported: false, reason: 'version' });
  });
});

describe('engine check: the probe, when the version is unknown', () => {
  it("Decaid's \"Decent\" user agent: an engine that parses the probe is supported", () => {
    expect(run({ userAgent: UA.decaid }).engine).toEqual({ chromium: null, supported: true, reason: 'probe' });
  });

  it('an engine that cannot parse private brand checks is older than Chromium 91', () => {
    expect(run({ userAgent: UA.decaid, functionCtor: FunctionWithoutBrandChecks }).engine).toEqual({
      chromium: null,
      supported: false,
      reason: 'probe',
    });
  });

  it('a policy that forbids eval says nothing about the engine: unknown, never warned', () => {
    expect(run({ userAgent: UA.decaid, noEval: true }).engine).toEqual({ chromium: null, supported: null, reason: 'probe' });
    const evalError = () => {
      throw new EvalError('Refused to evaluate a string as JavaScript');
    };
    expect(run({ userAgent: UA.decaid, functionCtor: evalError }).engine).toEqual({ chromium: null, supported: null, reason: 'probe' });
  });

  it('iOS WebKit has no Chromium version: the probe decides there too', () => {
    expect(run({ userAgent: UA.iosSafari }).engine).toEqual({ chromium: null, supported: true, reason: 'probe' });
    expect(run({ userAgent: UA.iosSafari, functionCtor: FunctionWithoutBrandChecks }).engine).toEqual({
      chromium: null,
      supported: false,
      reason: 'probe',
    });
  });

  it('a version that claims the floor still has to pass the probe', () => {
    expect(run({ userAgent: UA.chrome120, functionCtor: FunctionWithoutBrandChecks }).engine).toEqual({
      chromium: 120,
      supported: false,
      reason: 'probe',
    });
  });
});

describe('engine check: the console line', () => {
  it('writes one info line with the verdict, for the WebView log Decaid serves', () => {
    const { console } = run({ userAgent: UA.chrome85 });
    expect(console.info).toHaveBeenCalledTimes(1);
    expect(console.info).toHaveBeenCalledWith('[CafAI] engine check: {"chromium":85,"supported":false,"reason":"version"}');
    expect(console.error).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalled();
  });

  it('never copies the user agent into the log', () => {
    const { console } = run({ userAgent: UA.chrome91 });
    const line = String(console.info.mock.calls[0]?.[0]);
    expect(line).toBe('[CafAI] engine check: {"chromium":91,"supported":true,"reason":"probe"}');
    expect(line).not.toMatch(/Mozilla|Linux|HeadlessChrome|4469/);
  });

  it('logs nothing at error level in a normal start, even when the watchdog runs out', () => {
    const page = run({ userAgent: UA.chrome91 });
    vi.advanceTimersByTime(500);
    page.appRenders();
    vi.advanceTimersByTime(WATCHDOG_MS * 2);
    expect(page.console.error).not.toHaveBeenCalled();
    expect(page.console.warn).not.toHaveBeenCalled();
  });
});

describe('start-up watchdog', () => {
  it('listens for errors in both phases until the app starts', () => {
    const page = run({ userAgent: UA.chrome120 });
    expect(page.listeners.bubble.size).toBe(1);
    expect(page.listeners.capture.size).toBe(1);
  });

  it('never fires in a normal start, and then lets go of the page', () => {
    const page = run({ userAgent: UA.chrome120 });
    vi.advanceTimersByTime(300);
    page.appRenders();
    vi.advanceTimersByTime(WATCHDOG_MS);
    expect(page.fallback()).toBeNull();
    expect(page.listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('waits 15 s for a slow tablet before giving up', () => {
    const page = run({ userAgent: UA.chrome120 });
    vi.advanceTimersByTime(14_999);
    expect(page.fallback()).toBeNull();
    vi.advanceTimersByTime(1);
    expect(page.cause()).toBe('timeout');
  });

  it('an empty #root after the wait: a plain page with Exit and Decaid settings', () => {
    const page = run({ userAgent: UA.chrome85 });
    vi.advanceTimersByTime(WATCHDOG_MS - 100);
    expect(page.fallback()).toBeNull();
    vi.advanceTimersByTime(100);

    expect(page.fallback()).not.toBeNull();
    expect(page.cause()).toBe('timeout');
    expect(page.messages()).toEqual(["CafAI could not start on this tablet's browser engine (Chromium 85).", 'It needs Chromium 91 or newer.']);
    // Plain DOM checks: jest-dom needs a document with a window, and a parsed one has none.
    expect(page.fallback()!.querySelector('[role="alert"]')?.textContent).toContain('CafAI could not start');
    expect(page.exitButton()?.getAttribute('type')).toBe('button');
    expect(page.settingsLink()?.getAttribute('href')).toBe(`http://localhost${SETTINGS_PATH}`);
    expect(page.settingsLink()?.hasAttribute('target')).toBe(false);
  });

  it('both controls are full 48 px touch targets', () => {
    const page = run({ userAgent: UA.chrome85 });
    vi.advanceTimersByTime(WATCHDOG_MS);
    expect(page.exitButton()!.style.minHeight).toBe('48px');
    expect(page.settingsLink()!.style.minHeight).toBe('48px');
  });

  it('says nothing about a version it does not know', () => {
    const page = run({ userAgent: UA.decaid, functionCtor: FunctionWithoutBrandChecks });
    vi.advanceTimersByTime(WATCHDOG_MS);
    expect(page.messages()).toEqual(["CafAI could not start on this tablet's browser engine.", 'It needs Chromium 91 or newer.']);
  });

  it('does not blame a supported engine for a start that never came', () => {
    const page = run({ userAgent: UA.chrome120 });
    vi.advanceTimersByTime(WATCHDOG_MS);
    expect(page.messages()).toEqual(['CafAI could not start.', 'Exit to Decaid and open CafAI again.']);
    expect(page.exitButton()).not.toBeNull();
    expect(page.settingsLink()).not.toBeNull();
  });

  it('a SyntaxError before the app starts shows the page at once', () => {
    const page = run({ userAgent: UA.decaid, noEval: true });
    page.fireError(new SyntaxError("Unexpected token '?'"));
    expect(page.cause()).toBe('syntax');
    expect(page.messages()).toEqual(["CafAI could not start on this tablet's browser engine.", 'It needs Chromium 91 or newer.']);
  });

  it('recognizes a SyntaxError by its message when the event carries no error object', () => {
    const page = run({ userAgent: UA.decaid, noEval: true });
    page.fireWindowError({ error: null, message: "Uncaught SyntaxError: Unexpected token '?'" });
    expect(page.cause()).toBe('syntax');
  });

  it('a SyntaxError on an engine that passed the probe is not blamed on the engine', () => {
    const page = run({ userAgent: UA.chrome120 });
    page.fireError(new SyntaxError("Unexpected token '?'"));
    expect(page.messages()).toEqual(['CafAI could not start.', 'Exit to Decaid and open CafAI again.']);
  });

  it('ignores other errors until the wait is over', () => {
    const page = run({ userAgent: UA.chrome85 });
    // An uncaught error at window also passes the capture listener; it is not a failed load.
    page.fireError(new TypeError('x.at is not a function'));
    expect(page.fallback()).toBeNull();
    vi.advanceTimersByTime(WATCHDOG_MS);
    expect(page.cause()).toBe('timeout');
  });

  it('ignores a SyntaxError once the app has started (a bad JSON.parse is not a failed start)', () => {
    const page = run({ userAgent: UA.chrome120 });
    page.appRenders();
    page.fireError(new SyntaxError('Unexpected end of JSON input'));
    expect(page.fallback()).toBeNull();
    expect(page.listenerCount()).toBe(0);
    vi.advanceTimersByTime(WATCHDOG_MS);
    expect(page.fallback()).toBeNull();
  });

  it('gives the page back when a slow start renders after all', () => {
    const page = run({ userAgent: UA.chrome120 });
    vi.advanceTimersByTime(WATCHDOG_MS);
    expect(page.fallback()).not.toBeNull();
    page.appRenders();
    vi.advanceTimersByTime(1000);
    expect(page.fallback()).toBeNull();
    expect(page.listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shows the page once, however many triggers arrive', () => {
    const page = run({ userAgent: UA.chrome85 });
    page.fireError(new SyntaxError('a'));
    page.fireError(new SyntaxError('b'));
    vi.advanceTimersByTime(WATCHDOG_MS);
    expect(page.document.querySelectorAll('[data-cafai-start-failed]')).toHaveLength(1);
  });
});

describe('start-up watchdog: an app bundle that fails to load', () => {
  it('shows the page at once, without blaming a current engine', () => {
    const page = run({ userAgent: UA.chrome120 });
    page.fireLoadError(page.appScript());
    expect(page.cause()).toBe('load');
    expect(page.messages()).toEqual(['CafAI could not start.', 'Exit to Decaid and open CafAI again.']);
    expect(page.exitButton()).not.toBeNull();
    expect(page.settingsLink()).not.toBeNull();
  });

  it('names the engine when it is known to be too old', () => {
    const page = run({ userAgent: UA.chrome85 });
    page.fireLoadError(page.appScript());
    expect(page.cause()).toBe('load');
    expect(page.messages()).toEqual(["CafAI could not start on this tablet's browser engine (Chromium 85).", 'It needs Chromium 91 or newer.']);
  });

  it('any script counts, and a module preload too', () => {
    const polyfills = run({ userAgent: UA.chrome120 });
    polyfills.fireLoadError(polyfills.headElement('script', { type: 'module', crossorigin: '', src: './assets/polyfills-x.js' }));
    expect(polyfills.cause()).toBe('load');

    const preload = run({ userAgent: UA.chrome120 });
    preload.fireLoadError(preload.headElement('link', { rel: 'modulepreload', href: './assets/index-x.js' }));
    expect(preload.cause()).toBe('load');
  });

  it("other resources' errors do not count", () => {
    const page = run({ userAgent: UA.chrome120 });
    page.fireLoadError(page.headElement('link', { rel: 'stylesheet', href: './assets/index-x.css' }));
    page.fireLoadError(page.headElement('link', { rel: 'preload', as: 'font', href: './assets/roboto.woff2' }));
    page.fireLoadError(page.headElement('img', { src: './missing.png' }));
    expect(page.fallback()).toBeNull();
    // Still watching: the wait is what catches a start that never comes.
    expect(page.listenerCount()).toBe(2);
    vi.advanceTimersByTime(WATCHDOG_MS);
    expect(page.cause()).toBe('timeout');
  });

  it('after the app has started, a failed load changes nothing', () => {
    const page = run({ userAgent: UA.chrome120 });
    page.appRenders();
    page.fireLoadError(page.appScript());
    expect(page.fallback()).toBeNull();
    expect(page.listenerCount()).toBe(0);
    vi.advanceTimersByTime(WATCHDOG_MS);
    expect(page.fallback()).toBeNull();
  });

  it('a failed extra chunk on an engine that starts anyway: the page goes once the app renders', () => {
    const page = run({ userAgent: UA.chrome120 });
    page.fireLoadError(page.headElement('script', { type: 'module', src: './assets/polyfills-x.js' }));
    expect(page.fallback()).not.toBeNull();
    page.appRenders();
    vi.advanceTimersByTime(1000);
    expect(page.fallback()).toBeNull();
    expect(page.listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('start-up fallback: the ways back to Decaid (D12-D14)', () => {
  function failedStart(options: Sandbox) {
    const page = run({ userAgent: UA.chrome85, ...options });
    vi.advanceTimersByTime(WATCHDOG_MS);
    return page;
  }

  it('Exit calls decentApp.exitToDashboard() inside Decaid', () => {
    const exitToDashboard = vi.fn();
    const page = failedStart({ insideDecaid: true, decentApp: { exitToDashboard } });
    page.exitButton()!.click();
    expect(exitToDashboard).toHaveBeenCalledTimes(1);
    expect(page.assign).not.toHaveBeenCalled();
  });

  it('resolves exitToDashboard at tap time (skin-api.js may load late)', () => {
    const page = failedStart({ insideDecaid: true });
    const exitToDashboard = vi.fn();
    page.global.decentApp = { exitToDashboard };
    page.exitButton()!.click();
    expect(exitToDashboard).toHaveBeenCalledTimes(1);
  });

  it("in a browser Exit opens Decaid's settings (skin-api.js's exit is a no-op there)", () => {
    const exitToDashboard = vi.fn();
    const page = failedStart({ hostname: '192.168.1.42', decentApp: { exitToDashboard } });
    page.exitButton()!.click();
    expect(exitToDashboard).not.toHaveBeenCalled();
    expect(page.assign).toHaveBeenCalledWith(`http://192.168.1.42${SETTINGS_PATH}`);
  });

  it('builds the settings link exactly like the app does', () => {
    const cases: Sandbox[] = [
      { hostname: 'localhost' },
      { hostname: '192.168.1.42' },
      { reaHostname: '10.0.0.9' },
      { reaHostname: ' tablet.local ' },
      { reaHostname: '10.0.0.9:9090' },
      { reaHostname: 'http://10.0.0.42:8080/' },
      { storageThrows: true, hostname: '192.168.1.7' },
    ];
    for (const options of cases) {
      const page = failedStart(options);
      const host = detectHost({
        location: { protocol: 'http:', hostname: options.hostname ?? 'localhost', assign: () => {} },
        localStorage: {
          getItem: (key: string) => {
            if (options.storageThrows) throw new Error('SecurityError');
            return key === 'reaHostname' ? (options.reaHostname ?? null) : null;
          },
        },
      } as unknown as Window);
      expect(page.settingsLink()!.getAttribute('href'), JSON.stringify(options)).toBe(host.settingsUrl);
    }
  });
});

describe('start-up fallback: the look the app showed last', () => {
  const DEFAULT_LOOK = { background: '#14100D', ink: '#F6ECE3', line: 'rgba(246,236,227,0.4)' };

  function failedStart(options: Sandbox) {
    const page = run({ userAgent: UA.chrome85, ...options });
    vi.advanceTimersByTime(WATCHDOG_MS);
    return page;
  }

  it('draws in the colours the app saved for the boot screens, in its typeface', () => {
    const page = failedStart({ savedColors: '{"background":"#f4f8f3","ink":"#1a2218","line":"#d5dad4"}' });
    expect(page.look()).toEqual(lookOf({ background: '#f4f8f3', ink: '#1a2218', line: '#d5dad4' }));
    expect(page.fallback()!.style.fontFamily).toMatch(/^Figtree,/);
  });

  it('reads them as the app writes them', () => {
    const colors = bootColors(buildPalette('light', namedTint('matcha')));
    expect(failedStart({ savedColors: JSON.stringify(colors) }).look()).toEqual(lookOf(colors));
  });

  it('keeps the default dark look when none are saved, they are junk, or storage is blocked', () => {
    const junk = [
      'not json',
      'null',
      '[]',
      '"#f4f8f3"',
      '{"background":"red","ink":"#1a2218","line":"#d5dad4"}',
      '{"background":"#f4f8f3","ink":"#1a2218"}',
      // Only #rrggbb colours reach the page's CSS.
      '{"background":"#f4f8f3","ink":"#1a2218","line":"#d5dad4;display:none"}',
    ];
    const cases: Sandbox[] = [
      {},
      ...junk.map((savedColors) => ({ savedColors })),
      { storageThrows: true, savedColors: '{"background":"#f4f8f3","ink":"#1a2218","line":"#d5dad4"}' },
    ];
    for (const options of cases) {
      expect(failedStart(options).look(), JSON.stringify(options)).toEqual(lookOf(DEFAULT_LOOK));
    }
  });
});
