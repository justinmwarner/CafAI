/**
 * `npm run test:decaid`: CafAI against a running Decaid (src/api/live/*.decaid.ts,
 * spec 4.4). Standalone on purpose: the unit config in vite.config.ts never
 * includes *.decaid.ts, and only this config provides the flag the suites
 * check, so `npm test` cannot reach a machine even when DECAID_URL is set.
 *
 *   DECAID_URL=http://<tablet-ip>:8080 npm run test:decaid   read-only: safe on a tablet (D104)
 *   ... plus DECAID_WRITE=1                                  writes, each put back: a simulator only
 *   ... plus DECAID_SIM=1                                    a simulated shot (writes too)
 *   ... plus DECAID_REQUIRE=1                                the release gate: what cannot run fails
 *
 * Without DECAID_URL every suite is reported as skipped (it fails under DECAID_REQUIRE=1).
 */
import { defineConfig } from 'vitest/config';
import { BaseSequencer, type TestSpecification } from 'vitest/node';

/** The suites share one Decaid: the reads first, on a Decaid the writes have not touched, and the shot last. */
const ORDER = ['read', 'write', 'shot'];

class SuiteOrder extends BaseSequencer {
  override sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    const rank = (file: TestSpecification) => {
      const name = /([^/\\]+)\.decaid\.ts$/.exec(file.moduleId)?.[1] ?? '';
      const index = ORDER.indexOf(name);
      return index === -1 ? ORDER.length : index;
    };
    return Promise.resolve([...files].sort((a, b) => rank(a) - rank(b)));
  }
}

export default defineConfig({
  test: {
    include: ['src/**/*.decaid.ts'],
    environment: 'node',
    provide: { cafaiDecaidSuite: true },
    // Long enough for the client's own deadlines to fail first: the workflow round trip makes two
    // workflow PUTs (35 s each, then a read-back) and waits up to 20 s for the machine profile;
    // a simulated shot runs for up to 90 s.
    testTimeout: 240_000,
    // afterAll may put the workflow back too.
    hookTimeout: 180_000,
    // A failed check is a finding, not flakiness, and a retry would write twice.
    retry: 0,
    // One Decaid: the suites take turns, in SuiteOrder, their checks in order.
    fileParallelism: false,
    sequence: { sequencer: SuiteOrder },
    // Every check by name, so the run says what was checked and what was skipped.
    reporters: ['verbose'],
  },
});
