/**
 * When CafAI's checks against a running Decaid run (spec 4.4, D104), and what
 * they run with: CafAI's own client, a fetch that records every exchange, and
 * the pinned spec's validator (contract/decaid/schema.ts).
 *
 *   DECAID_URL=http://<tablet-ip>:8080 npm run test:decaid    read-only: safe on a tablet
 *   ... plus DECAID_WRITE=1                                   writes, each put back: a simulator only
 *   ... plus DECAID_SIM=1                                     a simulated shot (writes too)
 *   ... plus DECAID_REQUIRE=1                                 the release gate: a check that cannot run fails
 *
 * `npm test` never runs them: *.decaid.ts is outside the unit include, and
 * only vitest.decaid.config.ts provides DECAID_SUITE_FLAG, so a DECAID_URL
 * left in the environment cannot reach a machine from the unit tests.
 */
import { describe, inject, it } from 'vitest';
import type { SpecValidator } from '../../../contract/decaid/schema.ts';
import { createDecaidClient } from '../client.ts';
import { driftLog } from '../drift.ts';
import { DEFAULT_TIMEOUT_MS } from '../http.ts';
import type { DecaidClient } from '../types.ts';
import { recordExchanges, specProblems, type HttpMethod } from './harness.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    /** True only under vitest.decaid.config.ts. */
    cafaiDecaidSuite?: boolean;
  }
}

export const DECAID_SUITE_FLAG = 'cafaiDecaidSuite';

// ---------------------------------------------------------------------------
// When to run
// ---------------------------------------------------------------------------

export interface DecaidMode {
  /** Decaid's origin, e.g. "http://localhost:8080"; null skips every suite. */
  url: string | null;
  /** Why the suites are skipped; empty when they run. */
  reason: string;
  /** DECAID_WRITE=1 or DECAID_SIM=1: the writes run. */
  write: boolean;
  /** DECAID_SIM=1: the simulated shot runs. */
  sim: boolean;
  /** DECAID_REQUIRE=1, the release gate: a suite or check that cannot run fails instead of being skipped. */
  require: boolean;
}

const EXAMPLE = 'http://192.168.1.42:8080';

/** Decaid's address as an origin; anything else is refused with an example rather than half-used. */
function originOf(raw: string): string {
  let url: URL | null = null;
  try {
    url = new URL(raw);
  } catch {
    // Reported below.
  }
  const plain = url !== null && (url.protocol === 'http:' || url.protocol === 'https:') && url.pathname === '/' && !url.search && !url.hash;
  if (!url || !plain) throw new Error(`DECAID_URL must be Decaid's address, like ${EXAMPLE} (got "${raw}").`);
  return url.origin;
}

const on = (value: string | undefined) => (value ?? '').trim() === '1';

/**
 * Writes reach a machine, so they need exactly DECAID_WRITE=1 or
 * DECAID_SIM=1. Outside the Decaid config nothing runs, whatever the
 * environment says, DECAID_REQUIRE=1 included.
 */
export function decaidMode(env: Readonly<Record<string, string | undefined>>, underDecaidConfig: boolean): DecaidMode {
  if (!underDecaidConfig) {
    return { url: null, reason: 'the Decaid suites run only with npm run test:decaid', write: false, sim: false, require: false };
  }
  const required = on(env.DECAID_REQUIRE);
  const raw = (env.DECAID_URL ?? '').trim();
  if (raw === '') return { url: null, reason: 'DECAID_URL is not set', write: false, sim: false, require: required };
  const sim = on(env.DECAID_SIM);
  return { url: originOf(raw), reason: '', write: sim || on(env.DECAID_WRITE), sim, require: required };
}

export type SuiteKind = 'read' | 'write' | 'shot';

const NAMES: Record<SuiteKind, { running: string; skipped: string; what: string; needs: string | null }> = {
  read: { running: 'read-only', skipped: 'read-only', what: 'the read-only checks', needs: null },
  write: { running: 'writes, each put back', skipped: 'writes', what: 'the writes', needs: 'needs DECAID_WRITE=1, against a simulator only' },
  shot: { running: 'a simulated shot', skipped: 'a simulated shot', what: 'the simulated shot', needs: 'needs DECAID_SIM=1, against a simulator only' },
};

export interface Suite {
  title: string;
  /** Decaid's origin when the suite runs; null when it does not (the title says why). */
  url: string | null;
  /** Under DECAID_REQUIRE=1, why a suite that cannot run fails; null otherwise. */
  refusal: string | null;
}

/** A suite's title, and whether it runs, is skipped, or (DECAID_REQUIRE=1) fails for want of what it needs. */
export function suite(mode: DecaidMode, kind: SuiteKind): Suite {
  const name = NAMES[kind];
  const asked = kind === 'read' || (kind === 'write' ? mode.write : mode.sim);
  if (mode.url !== null && asked) return { title: `Decaid at ${mode.url}, ${name.running}`, url: mode.url, refusal: null };
  const why = mode.url === null ? mode.reason : name.needs;
  if (!mode.require) return { title: `Decaid, ${name.skipped} (skipped: ${why})`, url: null, refusal: null };
  return {
    title: `Decaid, ${name.skipped} (cannot run: ${why})`,
    url: null,
    refusal: `DECAID_REQUIRE=1 lets nothing be skipped, but ${name.what} cannot run: ${why}.`,
  };
}

/** What a running suite's checks get. */
export interface SuiteRun {
  /** Decaid's origin. */
  url: string;
  /** DECAID_REQUIRE=1: a check that cannot run fails rather than skips. */
  require: boolean;
}

/**
 * Declare one of the suites: its checks when it runs, every one reported as
 * skipped when it does not, and under DECAID_REQUIRE=1 one failing check that
 * says what is missing, so the release gate cannot pass on checks that never
 * ran.
 */
export function describeDecaid(kind: SuiteKind, checks: (run: SuiteRun) => void): void {
  const mode = decaidMode(process.env, inject(DECAID_SUITE_FLAG) === true);
  const { title, url, refusal } = suite(mode, kind);
  if (refusal !== null) {
    describe(title, () => {
      it('runs (DECAID_REQUIRE=1)', () => {
        throw new Error(refusal);
      });
    });
    return;
  }
  // A skipped suite's checks are still declared, so each is reported as skipped; none of them runs.
  describe.skipIf(url === null)(title, () => checks({ url: url ?? '', require: mode.require }));
}

// ---------------------------------------------------------------------------
// What the suites run with
// ---------------------------------------------------------------------------

/** A plain request is to an ordinary route (display, an archive, a visibility): the client's ordinary deadline. */
const SEND_TIMEOUT_MS = DEFAULT_TIMEOUT_MS;

export interface LiveDecaid {
  readonly url: string;
  /** CafAI's own client, on the recording fetch. */
  readonly client: DecaidClient;
  readonly validator: SpecValidator;
  /** The recording fetch, for the calls beside the client (grinders, the machine profile). */
  readonly fetch: typeof globalThis.fetch;
  /** A plain request, for routes CafAI's client has no call for; recorded and checked like the rest. */
  send(method: HttpMethod, path: string, body?: unknown): Promise<{ status: number; body: unknown }>;
  /** Start a test: forget the exchanges so far and clear CafAI's drift log. */
  reset(): void;
  /**
   * Since reset(): where the 2xx replies (and the bodies sent) differ from
   * the pinned spec, then what CafAI's readers and parsers reported as drift.
   */
  problems(): string[];
}

export async function openDecaid(url: string): Promise<LiveDecaid> {
  // Loaded here rather than imported: a skipped suite never reads the specs.
  const { loadSpecValidator } = await import('../../../contract/decaid/schema.ts');
  const validator = loadSpecValidator();
  const recorder = recordExchanges();
  const client = createDecaidClient({ origin: url, fetch: recorder.fetch });
  let from = 0;
  return {
    url,
    client,
    validator,
    fetch: recorder.fetch,
    async send(method, path, body) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
      const init: RequestInit = { method, signal: controller.signal };
      if (body !== undefined) {
        init.body = JSON.stringify(body);
        init.headers = { 'Content-Type': 'application/json' };
      }
      try {
        const response = await recorder.fetch(`${url}${path}`, init);
        const text = await response.text();
        let parsed: unknown = text;
        try {
          parsed = text.trim() === '' ? undefined : (JSON.parse(text) as unknown);
        } catch {
          // Not JSON: the text itself.
        }
        return { status: response.status, body: parsed };
      } finally {
        clearTimeout(timer);
      }
    },
    reset() {
      from = recorder.exchanges.length;
      driftLog.clear();
    },
    problems() {
      const drift = driftLog.list().map((entry) => `CafAI reported drift: ${entry.source}: ${entry.problem}`);
      return [...specProblems(validator, recorder.exchanges.slice(from)), ...drift];
    },
  };
}
