import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import {
  CHANNELS,
  FILES,
  GitHubError,
  ROOT,
  SpecMissingError,
  UPSTREAM,
  checkContract,
  contractTypecheck,
  fetchSpecs,
  generateRest,
  generateWs,
  specChannels,
} from './decaid-contract.mjs';
import { classifyTypecheck, diffSpecs, issueBody, latestTargets, runWatch, usedByCafai, watchedFiles } from './decaid-watch.mjs';

const temps = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

/** A copy of the contract's files in a temporary root, laid out like the repository. */
function copyContract() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cafai-contract-'));
  temps.push(dir);
  for (const file of Object.values(FILES)) {
    const to = path.join(dir, ...file.split('/'));
    mkdirSync(path.dirname(to), { recursive: true });
    cpSync(path.join(ROOT, ...file.split('/')), to);
  }
  return dir;
}

function edit(dir, file, change) {
  const full = path.join(dir, ...file.split('/'));
  writeFileSync(full, change(readFileSync(full, 'utf8')));
}

describe('decaid-contract --check', () => {
  it('passes on the committed files', () => {
    const out = execFileSync(process.execPath, ['scripts/decaid-contract.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' });
    expect(out).toMatch(/^ok - the Decaid contract matches the pin/);
  });

  it('fails on a changed byte in generated/rest.ts', async () => {
    const dir = copyContract();
    edit(dir, FILES.rest, (text) => text.replace('export interface paths {', 'export interface paths  {'));
    expect(await checkContract(dir)).toEqual([`${FILES.rest}: differs from what the pinned specs generate`]);
  });

  it('fails when a vendored spec or decaidVersion.ts was edited', async () => {
    const specEdited = copyContract();
    edit(specEdited, FILES.wsSpec, (text) => `${text}# edited\n`);
    expect(await checkContract(specEdited)).toEqual([`${FILES.wsSpec}: does not match PIN.json`]);
    const versionEdited = copyContract();
    edit(versionEdited, FILES.version, (text) => text.replace(/commit: '[0-9a-f]+'/, "commit: 'fffffff'"));
    expect(await checkContract(versionEdited)).toEqual([`${FILES.version}: differs from what the pinned specs generate`]);
  });

  it('reads a CRLF checkout as the same files', async () => {
    const dir = copyContract();
    for (const file of [FILES.restSpec, FILES.rest, FILES.version]) edit(dir, file, (text) => text.replace(/\n/g, '\r\n'));
    expect(await checkContract(dir)).toEqual([]);
  });
});

describe('the channel map', () => {
  it('lists every channel in the pinned spec, with its frames', () => {
    const doc = parse(readFileSync(path.join(ROOT, FILES.wsSpec), 'utf8'));
    expect(CHANNELS).toEqual(specChannels(doc));
  });
});

describe('decaid-watch', () => {
  const pinnedRest = () => parse(readFileSync(path.join(ROOT, FILES.restSpec), 'utf8'));
  const pinnedWs = () => parse(readFileSync(path.join(ROOT, FILES.wsSpec), 'utf8'));
  /** What main had over v0.8.8 on 2026-10-09: grinderBurrs in the context, grinder as a WebSocket device type. */
  function additive() {
    const rest = pinnedRest();
    const ws = pinnedWs();
    for (const name of ['WorkflowContext', 'WorkflowContextPatch']) {
      rest.components.schemas[name].properties.grinderBurrs = { type: 'string', nullable: true };
    }
    ws.components.schemas.DeviceInfo.properties.type.enum.push('grinder');
    return { rest, ws };
  }

  it('sorts the contract typecheck into unexpected, stale and other errors', () => {
    const output = [
      `contract/decaid/checks/ws.ts(29,36): error TS2344: Type '{ unexpected: "weightFlow: absent in source"; }' does not satisfy the constraint 'true'.`,
      `contract/decaid/checks/enums.ts(20,3): error TS2344: Type '{ stale: "CafAI only: grinder"; }' does not satisfy the constraint 'true'.`,
      `contract/decaid/checks/rest-read.ts(9,1): error TS2307: Cannot find module '#decaid/rest'.`,
    ].join('\n');
    expect(classifyTypecheck(output)).toEqual({
      unexpected: ['checks/ws.ts:29: weightFlow: absent in source'],
      stale: ['checks/enums.ts:20: CafAI only: grinder'],
      other: [`contract/decaid/checks/rest-read.ts(9,1): error TS2307: Cannot find module '#decaid/rest'.`],
    });
  });

  it('knows which operations and channels CafAI uses, from the checks', () => {
    const used = usedByCafai();
    expect(used.operations).toEqual(expect.arrayContaining(['GET /api/v1/workflow', 'PUT /api/v1/workflow', 'POST /api/v1/machine/profile']));
    expect(used.operations).not.toContain('GET /api/v1/steams');
    expect(used.channels).toEqual(expect.arrayContaining(['ws/v1/machine/snapshot', 'ws/v1/devices']));
  });

  it('diffs the specs: operations CafAI calls, and fields of the schemas it uses', () => {
    const before = { rest: pinnedRest(), ws: pinnedWs() };
    const after = additive();
    after.rest.paths['/api/v1/new'] = { get: { responses: { 200: { description: 'ok' } } } };
    delete after.rest.paths['/api/v1/steams'];
    const diff = diffSpecs(before, after, usedByCafai());
    expect(diff.operations.added).toEqual(['GET /api/v1/new']);
    expect(diff.operations.removed).toEqual(['GET /api/v1/steams']);
    expect(diff.operations.removedUsed).toEqual([]);
    expect(diff.schemas).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^\+ rest WorkflowContext\.properties\.grinderBurrs/),
        expect.stringMatching(/^~ websocket DeviceInfo\.properties\.type\.enum/),
      ]),
    );
  });

  it('keeps the changed files CafAI depends on', () => {
    const files = [
      { filename: 'lib/src/models/data/workflow_context.dart', status: 'modified', additions: 13, deletions: 0 },
      { filename: 'lib/src/ui/home.dart', status: 'modified', additions: 2, deletions: 1 },
      { filename: 'assets/api/rest_v1.yml', status: 'modified', additions: 22, deletions: 0 },
    ];
    expect(watchedFiles(files).map((file) => file.filename)).toEqual(['lib/src/models/data/workflow_context.dart', 'assets/api/rest_v1.yml']);
  });

  it('reports an additive main as passing, with the exceptions Decaid made stale', async () => {
    const pin = JSON.parse(readFileSync(path.join(ROOT, FILES.pin), 'utf8'));
    const { rest, ws } = additive();
    const specs = {
      [pin.commit]: { restText: readFileSync(path.join(ROOT, FILES.restSpec), 'utf8'), wsText: readFileSync(path.join(ROOT, FILES.wsSpec), 'utf8') },
      ['f'.repeat(40)]: { restText: stringify(rest), wsText: stringify(ws) },
    };
    const { code, report } = await runWatch({
      targets: async () => [
        { name: 'latest release v0.8.8', sha: pin.commit },
        { name: 'main', sha: 'f'.repeat(40) },
      ],
      fetchSpecs: async (sha) => specs[sha],
      compare: async () => [{ filename: 'lib/src/models/data/workflow_context.dart', status: 'modified', additions: 13, deletions: 0 }],
      now: () => new Date('2026-10-09T07:17:00Z'),
    });
    expect(code).toBe(0);
    expect(report).toMatch(/## latest release v0\.8\.8/);
    expect(report).toMatch(/same commit as the pin/i);
    expect(report).toMatch(/## main/);
    expect(report).toMatch(/additive/i);
    expect(report).toMatch(/CafAI only: grinder/);
    expect(report).toMatch(/grinderBurrs/);
    expect(report).toMatch(/lib\/src\/models\/data\/workflow_context\.dart/);
  }, 180_000);

  it('answers 2 when GitHub cannot be reached', async () => {
    const { code, report } = await runWatch({
      targets: async () => {
        throw new GitHubError('GitHub could not be reached (offline)');
      },
    });
    expect(code).toBe(2);
    expect(report).toMatch(/GitHub could not be reached/);
  });

  const MAIN = 'f'.repeat(40);
  const pinned = () => JSON.parse(readFileSync(path.join(ROOT, FILES.pin), 'utf8'));
  const pinnedSpecs = async () => ({
    restText: readFileSync(path.join(ROOT, FILES.restSpec), 'utf8'),
    wsText: readFileSync(path.join(ROOT, FILES.wsSpec), 'utf8'),
  });
  /** raw.githubusercontent.com answering `status` for the WebSocket spec and 200 for the REST one. */
  const wsAnswers = (status) => async (url) => new Response('openapi: 3.0.3', { status: String(url).endsWith('websocket_v1.yml') ? status : 200 });

  it('reads a missing spec file as Decaid no longer serving it, anything else as GitHub trouble', async () => {
    await expect(fetchSpecs(MAIN, { fetch: wsAnswers(404) })).rejects.toThrow(`Decaid no longer serves ${UPSTREAM.ws} at fffffff`);
    await expect(fetchSpecs(MAIN, { fetch: wsAnswers(404) })).rejects.toBeInstanceOf(SpecMissingError);
    await expect(fetchSpecs(MAIN, { fetch: wsAnswers(503) })).rejects.toBeInstanceOf(GitHubError);
    const offline = async () => {
      throw new TypeError('fetch failed');
    };
    await expect(fetchSpecs(MAIN, { fetch: offline })).rejects.toThrow('GitHub could not be reached (fetch failed)');
  });

  it('fails a target whose spec Decaid no longer serves (exit 1)', async () => {
    const { code, report } = await runWatch({
      targets: async () => [{ name: 'main', sha: MAIN }],
      fetchSpecs: (sha) => fetchSpecs(sha, { fetch: wsAnswers(404) }),
      compare: async () => [],
    });
    expect(code).toBe(1);
    expect(report).toMatch(/\| main \| fffffff \| a check failed \|/);
    expect(report).toMatch(/Decaid no longer serves assets\/api\/websocket_v1\.yml at fffffff/);
  });

  it('reports the targets that worked when GitHub fails on another, with a warning (exit 0)', async () => {
    const { code, report } = await runWatch({
      targets: async () => [
        { name: 'latest release v0.8.8', sha: pinned().commit },
        { name: 'main', sha: MAIN },
      ],
      fetchSpecs: async () => {
        throw new GitHubError(`GitHub answered 502 for ${UPSTREAM.rest} at ${MAIN}`, 502);
      },
      compare: async () => [],
    });
    expect(code).toBe(0);
    expect(report).toMatch(/\| latest release v0\.8\.8 \| aab5f93 \| same commit as the pin \|/);
    expect(report).toMatch(/\*\*Warning:\*\* 1 of 2 Decaid versions could not be checked/);
    expect(report).toMatch(/\| main \| fffffff \| could not be checked \|/);
    expect(report).toMatch(/GitHub answered 502/);
  });

  it('keeps checking a target when its changed files cannot be listed', async () => {
    const { code, report } = await runWatch({
      targets: async () => [{ name: 'main', sha: MAIN }],
      fetchSpecs: pinnedSpecs,
      compare: async () => {
        throw new GitHubError('GitHub answered 502 for the compare', 502);
      },
    });
    expect(code).toBe(0);
    expect(report).toMatch(/No spec change/);
    expect(report).toMatch(/Could not list the changed files: GitHub answered 502 for the compare/);
  });

  it('checks main when the latest release cannot be looked up', async () => {
    const lookup = async (pathname) => {
      if (pathname.endsWith('/releases/latest')) throw new GitHubError('GitHub answered 503 for releases/latest', 503);
      if (pathname.endsWith('/commits/main')) return { sha: pinned().commit };
      throw new Error(`not faked: ${pathname}`);
    };
    const { code, report } = await runWatch({ targets: () => latestTargets(lookup), fetchSpecs: pinnedSpecs, compare: async () => [] });
    expect(code).toBe(0);
    expect(report).toMatch(/\| latest release \| - \| could not be checked \|/);
    expect(report).toMatch(/\| main \| aab5f93 \| same commit as the pin \|/);
  });

  it('answers 2 when no target could be checked', async () => {
    const offline = async () => {
      throw new GitHubError('GitHub could not be reached (fetch failed)');
    };
    const { code, report } = await runWatch({
      targets: async () => [
        { name: 'latest release v9.9.9', sha: 'e'.repeat(40) },
        { name: 'main', sha: MAIN },
      ],
      fetchSpecs: offline,
      compare: offline,
    });
    expect(code).toBe(2);
    expect(report).toMatch(/\*\*Warning:\*\* 2 of 2 Decaid versions could not be checked/);
  });

  it('cuts an issue body that is too long at a line, pointing at the full report', () => {
    const lines = Array.from({ length: 60 }, (_, index) => `line ${index} ${'x'.repeat(20)}`);
    const body = issueBody(lines.join('\n'), { limit: 500, runUrl: 'https://github.com/owner/cafai/actions/runs/7' });
    expect(body.length).toBeLessThanOrEqual(500);
    const [kept, note] = body.split('\n\n');
    expect(kept.split('\n').every((line) => lines.includes(line))).toBe(true);
    expect(note).toMatch(/https:\/\/github\.com\/owner\/cafai\/actions\/runs\/7/);
    expect(note).toMatch(/decaid-drift-report/);
    expect(issueBody('A short report.', { limit: 500 })).toBe('A short report.');
  });
});

describe('the contract typecheck', () => {
  it('fails when Decaid renames, nulls or drops a field CafAI reads', async () => {
    const rest = parse(readFileSync(path.join(ROOT, FILES.restSpec), 'utf8'));
    const ws = parse(readFileSync(path.join(ROOT, FILES.wsSpec), 'utf8'));
    // The scale frame renames weightFlow; the machine's pressure may be null; a shot loses createdAt.
    const scale = ws.components.schemas.ScaleSnapshot.properties;
    scale.flowRate = scale.weightFlow;
    delete scale.weightFlow;
    rest.components.schemas.MachineSnapshot.properties.pressure.nullable = true;
    delete rest.components.schemas.ShotRecordSummary.properties.createdAt;

    const dir = mkdtempSync(path.join(os.tmpdir(), 'cafai-mutated-'));
    temps.push(dir);
    writeFileSync(path.join(dir, 'rest.ts'), await generateRest(stringify(rest), 'mutated'));
    writeFileSync(path.join(dir, 'ws.ts'), await generateWs(stringify(ws), 'mutated'));
    const { ok, output } = contractTypecheck(dir);

    expect(ok).toBe(false);
    const errors = output.split('\n').filter((line) => /error TS/.test(line));
    expect(errors.every((line) => /error TS2344: Type '\{ unexpected: /.test(line))).toBe(true);
    expect(output).toMatch(/unexpected: "weightFlow: absent in source"/);
    expect(output).toMatch(/unexpected: "pressure: null not accepted"/);
    expect(output).toMatch(/"items\[\]\.createdAt: absent in source"/);
    expect(output).not.toMatch(/stale/);
  }, 180_000);
});
