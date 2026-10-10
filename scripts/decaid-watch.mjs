#!/usr/bin/env node
// Would the newest Decaid break CafAI? (spec 4.3)
//
// For Decaid's latest release and its main branch: when the specs differ from
// the pin's, generate their types into a temporary folder, run the contract
// typecheck with the #decaid aliases pointed there, run the mock contract test
// (fixtures and the mock's replies and frames) against the new spec, and diff
// the specs: operations added or removed (and whether CafAI calls them), and
// fields added, removed or retyped in the schemas CafAI reads or writes. Then
// list the Decaid files changed since the pin that CafAI depends on (GitHub's
// compare API, filtered by WATCH), as "read these".
//
// Prints a markdown report (--report <file> writes it too; --issue <file>
// writes it cut to fit a GitHub issue). Each Decaid version is checked on its
// own: one GitHub could not serve is a warning in the report, and the others
// still count. Exit 0: nothing changed, or the changes are additive and every
// check passes (an exception Decaid has fixed, `stale`, is reported for when
// the pin moves, not failed); 1: a check failed, a spec file included (Decaid
// no longer serves it); 2: GitHub could not be reached for any version;
// 3: the watch itself broke.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import {
  CHILD_TIMEOUT_MS,
  FILES,
  GitHubError,
  REPO,
  ROOT,
  SpecMissingError,
  childOutput,
  contractTypecheck,
  fetchSpecs as fetchSpecsFromGitHub,
  generateRest,
  generateWs,
  github,
  lf,
  sha256,
  specChannels,
} from './decaid-contract.mjs';

/** The Decaid paths CafAI depends on: the specs, the skin docs, the handlers and models it reads, the plugins it uses. */
export const WATCH = [
  'assets/api/',
  'doc/Skins.md',
  'doc/Api.md',
  'lib/src/services/webserver/',
  'lib/src/models/data/',
  'lib/src/models/device/',
  'lib/src/skin_feature/',
  'lib/src/webui_support/',
  'assets/plugins/visualizer.reaplugin/',
  'assets/plugins/time-to-ready.reaplugin/',
  'assets/plugins/settings.reaplugin/',
  // DYE2 is not in Decaid's tree (assets/plugins/dye2.reaplugin/ is gitignored):
  // this script downloads the release Decaid bundles, pinned by version and sha256.
  'scripts/fetch_dye2_plugin.sh',
];

/** GitHub's issue body limit is 65,536 characters; the rest of a longer report is in the run's artifact. */
const ISSUE_LIMIT = 60_000;
const ARTIFACT = 'decaid-drift-report';

const CHECKS_DIR = path.join(ROOT, 'contract', 'decaid', 'checks');
const METHODS = ['get', 'put', 'post', 'delete', 'patch'];
const short = (sha) => String(sha).slice(0, 7);

// ---------------------------------------------------------------------------
// The parts
// ---------------------------------------------------------------------------

/** The contract typecheck's errors: `unexpected` (new drift), `stale` (drift Decaid fixed) and anything else. */
export function classifyTypecheck(output) {
  const sorted = { unexpected: [], stale: [], other: [] };
  for (const line of output.split(/\r?\n/)) {
    if (!/error TS\d+/.test(line)) continue;
    const match = /(checks\/[\w-]+\.ts)\((\d+),\d+\): error TS2344: Type '\{ (unexpected|stale): (.*); \}' does not satisfy the constraint 'true'\.$/.exec(line);
    if (!match) {
      sorted.other.push(line.trim());
      continue;
    }
    const [, file, row, kind, members] = match;
    const quoted = [...members.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(([, member]) => member);
    for (const member of quoted.length > 0 ? quoted : [members]) sorted[kind].push(`${file}:${row}: ${member}`);
  }
  return sorted;
}

/** The operations ("GET /api/v1/workflow") and channels CafAI uses, as the contract checks name them. */
export function usedByCafai(checksDir = CHECKS_DIR) {
  const operations = new Set();
  const channels = new Set();
  for (const name of readdirSync(checksDir).filter((file) => file.endsWith('.ts'))) {
    const text = readFileSync(path.join(checksDir, name), 'utf8');
    for (const [, route, method] of text.matchAll(/(?:Res|Body|Statuses|PathParams|Lacks|Documents)<\s*'(\/api\/v1\/[^']*)',\s*'(get|put|post|delete|patch)'/g)) {
      operations.add(`${method.toUpperCase()} ${route}`);
    }
    for (const [, channel] of text.matchAll(/'(ws\/v1\/[^']+)'/g)) channels.add(channel);
  }
  return { operations: [...operations].sort(), channels: [...channels].sort() };
}

/** The changed files under WATCH. */
export function watchedFiles(files) {
  return files.filter((file) => WATCH.some((prefix) => file.filename.startsWith(prefix)));
}

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** A schema without its prose; a property named "description" stays. */
function strip(node, inProperties = false) {
  if (Array.isArray(node)) return node.map((item) => strip(item));
  if (!isObject(node)) return node;
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (!inProperties && ['description', 'example', 'examples', 'summary'].includes(key)) continue;
    out[key] = strip(value, !inProperties && (key === 'properties' || key === 'patternProperties'));
  }
  return out;
}

/** Leaf differences between two stripped schemas, as "+ path = new", "- path (was old)", "~ path: old -> new". */
function leafDiff(a, b, at, out) {
  if (same(a, b)) return out;
  if (isObject(a) && isObject(b)) {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(key in a)) out.push(`+ ${at}.${key} = ${JSON.stringify(b[key]).slice(0, 160)}`);
      else if (!(key in b)) out.push(`- ${at}.${key} (was ${JSON.stringify(a[key]).slice(0, 160)})`);
      else leafDiff(a[key], b[key], `${at}.${key}`, out);
    }
  } else {
    out.push(`~ ${at}: ${JSON.stringify(a)?.slice(0, 120)} -> ${JSON.stringify(b)?.slice(0, 120)}`);
  }
  return out;
}

function operationsOf(doc) {
  const out = {};
  for (const [route, item] of Object.entries(doc.paths ?? {})) {
    for (const [method, op] of Object.entries(item ?? {})) if (METHODS.includes(method)) out[`${method.toUpperCase()} ${route}`] = op;
  }
  return out;
}

/** Schema names reachable through $refs from `roots`. */
function reachable(doc, roots) {
  const names = new Set();
  const visit = (node) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!isObject(node)) return;
    if (typeof node.$ref === 'string' && node.$ref.startsWith('#/components/schemas/')) {
      const name = node.$ref.slice('#/components/schemas/'.length);
      if (!names.has(name)) {
        names.add(name);
        visit(doc.components?.schemas?.[name]);
      }
    }
    Object.values(node).forEach(visit);
  };
  roots.forEach(visit);
  return names;
}

/** A spec address matching a concrete channel ("ws/v1/plugins/{id}/{endpoint}" for a plugin's). */
const addressMatches = (address, channel) =>
  new RegExp(`^${address.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{[^}]+\}/g, '[^/]+')}$`).test(channel);

function usedSchemas(docs, used) {
  const restOps = operationsOf(docs.rest);
  const rest = reachable(docs.rest, used.operations.map((op) => restOps[op]).filter(Boolean));
  const map = specChannels(docs.ws);
  const roots = Object.entries(map)
    .filter(([address]) => used.channels.some((channel) => addressMatches(address, channel)))
    .flatMap(([, entry]) => [...(entry.receive ?? []), ...(entry.send ?? [])].map((name) => ({ $ref: `#/components/schemas/${name}` })));
  return { rest, websocket: reachable(docs.ws, roots) };
}

/** What changed between two spec pairs, as far as CafAI is concerned. */
export function diffSpecs(before, after, used) {
  const opsBefore = operationsOf(before.rest);
  const opsAfter = operationsOf(after.rest);
  const added = Object.keys(opsAfter).filter((op) => !(op in opsBefore));
  const removed = Object.keys(opsBefore).filter((op) => !(op in opsAfter));
  const changedUsed = used.operations.filter((op) => op in opsBefore && op in opsAfter && !same(strip(opsBefore[op]), strip(opsAfter[op])));

  const schemas = [];
  const namesBefore = usedSchemas(before, used);
  const namesAfter = usedSchemas(after, used);
  for (const [label, key] of [['rest', 'rest'], ['websocket', 'ws']]) {
    const all = [...new Set([...namesBefore[label], ...namesAfter[label]])].sort();
    for (const name of all) {
      const a = before[key].components?.schemas?.[name];
      const b = after[key].components?.schemas?.[name];
      if (a === undefined) schemas.push(`+ ${label} ${name} (new schema)`);
      else if (b === undefined) schemas.push(`- ${label} ${name} (removed)`);
      else for (const line of leafDiff(strip(a), strip(b), name, [])) schemas.push(`${line[0]} ${label} ${line.slice(2)}`);
    }
  }

  const channelsBefore = Object.keys(specChannels(before.ws));
  const channelsAfter = Object.keys(specChannels(after.ws));
  const usedAddress = (address) => used.channels.some((channel) => addressMatches(address, channel));
  const channelsRemoved = channelsBefore.filter((address) => !channelsAfter.includes(address));
  return {
    operations: { added, removed, removedUsed: removed.filter((op) => used.operations.includes(op)), changedUsed },
    schemas,
    channels: {
      added: channelsAfter.filter((address) => !channelsBefore.includes(address)),
      removed: channelsRemoved,
      removedUsed: channelsRemoved.filter(usedAddress),
    },
  };
}

/** The mock contract test (fixtures, the mock's replies and frames) against the specs in `specDir`. */
function runMockContract(specDir) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('VITEST')));
  const vitest = path.join(ROOT, 'node_modules', 'vitest', 'vitest.mjs');
  const result = spawnSync(
    process.execPath,
    [vitest, 'run', 'mock/decaid/contract.test.ts', '-t', 'the fixtures|the mock against the spec'],
    { cwd: ROOT, env: { ...env, DECAID_SPEC_DIR: specDir, FORCE_COLOR: '0', NO_COLOR: '1' }, encoding: 'utf8', timeout: CHILD_TIMEOUT_MS },
  );
  const output = childOutput(result, 'vitest');
  const problems = output
    .split(/\r?\n/)
    .filter((line) => /^\s*\+\s+"/.test(line) || /^\s*(FAIL|×)\s/.test(line))
    .map((line) => line.trim());
  return { ok: result.status === 0, problems: problems.length > 0 ? problems.slice(0, 40) : output.split(/\r?\n/).slice(-20) };
}

const failedTarget = (result) =>
  Boolean(
    result.missingSpec ||
      result.generationError ||
      (result.typecheck && (result.typecheck.unexpected.length > 0 || result.typecheck.other.length > 0)) ||
      (result.mock && !result.mock.ok),
  );

/** A version GitHub could not serve: reported as a warning, not as a failed check. */
const unreachableTarget = (result) => Boolean(result.unreachable);

async function checkTarget(target, { pin, pinDocs, used, fetchSpecs, compare, keep }) {
  if (target.error) return { ...target, sha: null, unreachable: target.error, files: [] };
  const result = { ...target, sameCommit: target.sha === pin.commit, specsChanged: false, files: [] };
  if (result.sameCommit) return result;
  try {
    result.files = watchedFiles(await compare(pin.commit, target.sha));
  } catch (error) {
    if (!(error instanceof GitHubError)) throw error;
    result.filesError = error.message;
  }
  let restText;
  let wsText;
  try {
    ({ restText, wsText } = await fetchSpecs(target.sha));
  } catch (error) {
    if (error instanceof SpecMissingError) result.missingSpec = error.message;
    else if (error instanceof GitHubError) result.unreachable = error.message;
    else throw error;
    return result;
  }
  result.specsChanged = sha256(restText) !== pin.specs.rest.sha256 || sha256(wsText) !== pin.specs.ws.sha256;
  if (!result.specsChanged) return result;

  const dir = mkdtempSync(path.join(os.tmpdir(), 'cafai-watch-'));
  try {
    const specDir = path.join(dir, 'spec');
    mkdirSync(specDir);
    writeFileSync(path.join(specDir, 'rest_v1.yml'), lf(restText));
    writeFileSync(path.join(specDir, 'websocket_v1.yml'), lf(wsText));
    try {
      result.diff = diffSpecs(pinDocs, { rest: parse(lf(restText)), ws: parse(lf(wsText)) }, used);
      writeFileSync(path.join(dir, 'rest.ts'), await generateRest(restText, target.sha));
      writeFileSync(path.join(dir, 'ws.ts'), await generateWs(wsText, target.sha));
    } catch (error) {
      result.generationError = error instanceof Error ? error.message : String(error);
      return result;
    }
    const { ok, output } = contractTypecheck(dir);
    result.typecheck = classifyTypecheck(output);
    const sorted = result.typecheck;
    if (!ok && sorted.unexpected.length + sorted.stale.length + sorted.other.length === 0) {
      sorted.other.push(output.trim().split(/\r?\n/).slice(-5).join(' ') || 'tsc failed without a message');
    }
    result.mock = runMockContract(specDir);
  } finally {
    if (!keep) rmSync(dir, { recursive: true, force: true });
  }
  return result;
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

function verdict(result) {
  if (unreachableTarget(result)) return 'could not be checked';
  if (result.sameCommit) return 'same commit as the pin';
  if (result.missingSpec) return 'a check failed';
  if (!result.specsChanged) return 'no spec change';
  return failedTarget(result) ? 'a check failed' : 'specs changed: additive, every check passes';
}

const code = (text) => `\`${String(text).replace(/`/g, "'")}\``;
const commitOf = (result) => (result.sha ? short(result.sha) : '-');

function targetSection(result) {
  const lines = [`## ${result.name}${result.sha ? ` (${short(result.sha)})` : ''}`, ''];
  if (result.sameCommit) return [...lines, 'The same commit as the pin: nothing to check.', ''];
  if (unreachableTarget(result)) {
    lines.push(`**Could not be checked:** ${result.unreachable}. The next run tries again.`, '');
  } else if (result.missingSpec) {
    lines.push(
      `**A check failed:** ${result.missingSpec}. The spec moved or was removed: find where it went before moving the pin (UPSTREAM in scripts/decaid-contract.mjs).`,
      '',
    );
  } else if (!result.specsChanged) {
    lines.push('No spec change: both specs have the pin\'s hashes.', '');
  } else if (result.generationError) {
    lines.push(`**A check failed:** openapi-typescript could not generate types from this spec: ${result.generationError}`, '');
  } else {
    lines.push(failedTarget(result) ? '**A check failed: CafAI may break on this Decaid.**' : '**Additive: every check passes.**', '');
    const { unexpected, stale, other } = result.typecheck;
    if (unexpected.length + other.length > 0) {
      lines.push('- Contract typecheck: **fails**.');
      for (const entry of [...unexpected.map((item) => `unexpected: ${item}`), ...other]) lines.push(`  - ${code(entry)}`);
    } else {
      lines.push('- Contract typecheck: passes.');
    }
    if (stale.length > 0) {
      lines.push('- Decaid fixed what these exceptions record; remove them from contract/decaid/drift.ts when the pin moves:');
      for (const entry of stale) lines.push(`  - ${code(entry)}`);
    }
    lines.push(result.mock.ok ? '- Mock contract test against this spec: passes.' : '- Mock contract test against this spec: **fails**.');
    if (!result.mock.ok) for (const entry of result.mock.problems) lines.push(`  - ${code(entry)}`);
    const { operations, channels, schemas } = result.diff;
    lines.push(
      `- Operations: ${operations.added.length} added, ${operations.removed.length} removed` +
        (operations.removedUsed.length > 0 ? `, **of which CafAI calls ${operations.removedUsed.join(', ')}**` : ', none that CafAI calls') +
        '.',
    );
    if (operations.added.length > 0) lines.push(`  - added: ${operations.added.map(code).join(', ')}`);
    if (operations.changedUsed.length > 0) lines.push(`  - changed, and CafAI calls them: ${operations.changedUsed.map(code).join(', ')}`);
    if (channels.added.length + channels.removed.length > 0) {
      lines.push(
        `- Channels: ${channels.added.length} added, ${channels.removed.length} removed` +
          (channels.removedUsed.length > 0 ? `, **of which CafAI opens ${channels.removedUsed.join(', ')}**` : '') +
          '.',
      );
    }
    lines.push('', '### What changed in the schemas CafAI uses', '');
    if (schemas.length === 0) lines.push('Nothing.');
    for (const entry of schemas) lines.push(`- ${code(entry)}`);
    lines.push('');
  }
  if (!result.sha) return lines;
  lines.push('### Files changed since the pin that CafAI depends on (read these)', '');
  if (result.filesError) lines.push(`Could not list the changed files: ${result.filesError}.`);
  else if (result.files.length === 0) lines.push('None.');
  for (const file of result.files) lines.push(`- ${code(file.filename)} (${file.status}, +${file.additions} -${file.deletions})`);
  lines.push('');
  return lines;
}

export function formatReport({ pin, results, now }) {
  const lines = [
    '# Decaid drift watch',
    '',
    `Checked ${now.toISOString().slice(0, 16).replace('T', ' ')} UTC against the pin: Decaid ${pin.release ?? '(no tag)'} (${short(pin.commit)}). ` +
      'Exit 0 means nothing changed or the changes are additive and every check passes; 1 that a check failed; ' +
      '2 that GitHub could not be reached for any version.',
    '',
    '| Decaid | Commit | Verdict |',
    '|---|---|---|',
    ...results.map((result) => `| ${result.name} | ${commitOf(result)} | ${verdict(result)} |`),
    '',
  ];
  const unreachable = results.filter(unreachableTarget);
  if (unreachable.length > 0) {
    lines.push(
      `**Warning:** ${unreachable.length} of ${results.length} Decaid versions could not be checked: ` +
        `${unreachable.map((result) => `${result.name} (${result.unreachable})`).join('; ')}.`,
      '',
    );
  }
  for (const result of results) lines.push(...targetSection(result));
  return lines.join('\n');
}

/** The report cut to fit a GitHub issue, at a line, with where to find the rest. */
export function issueBody(report, { limit = ISSUE_LIMIT, runUrl = null } = {}) {
  if (report.length <= limit) return report;
  const note =
    `The report is longer than an issue can hold. The whole of it is the ${ARTIFACT} artifact of ` +
    `${runUrl ?? 'the workflow run that filed this'}.`;
  const cut = report.slice(0, Math.max(0, limit - note.length - 2));
  const end = cut.lastIndexOf('\n');
  return `${end > 0 ? cut.slice(0, end) : cut}\n\n${note}`;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

async function commitSha(get, ref) {
  const commit = await get(`repos/${REPO}/commits/${encodeURIComponent(ref)}`);
  if (typeof commit?.sha !== 'string') throw new GitHubError(`GitHub sent no commit for ${ref}`);
  return commit.sha;
}

/**
 * The latest release and main, as commits. Each is looked up on its own: one
 * GitHub cannot serve comes back as `{ name, error }`, and the other is still
 * checked. `get` is the GitHub API call (swapped in tests).
 */
export async function latestTargets(get = github) {
  const targets = [];
  try {
    const release = await get(`repos/${REPO}/releases/latest`);
    const tag = String(release?.tag_name ?? '');
    if (tag === '') throw new GitHubError('GitHub sent no latest release');
    targets.push({ name: `latest release ${tag}`, sha: await commitSha(get, tag) });
  } catch (error) {
    if (!(error instanceof GitHubError)) throw error;
    targets.push({ name: 'latest release', error: error.message });
  }
  try {
    targets.push({ name: 'main', sha: await commitSha(get, 'main') });
  } catch (error) {
    if (!(error instanceof GitHubError)) throw error;
    targets.push({ name: 'main', error: error.message });
  }
  return targets;
}

async function compareOnGitHub(base, head) {
  const comparison = await github(`repos/${REPO}/compare/${base}...${head}`);
  return Array.isArray(comparison?.files) ? comparison.files : [];
}

/** Run the watch; GitHub's parts can be swapped for tests. Answers the exit code and the report. */
export async function runWatch({
  targets = () => latestTargets(),
  fetchSpecs = (sha) => fetchSpecsFromGitHub(sha),
  compare = compareOnGitHub,
  now = () => new Date(),
  keep = false,
} = {}) {
  const pin = JSON.parse(readFileSync(path.join(ROOT, ...FILES.pin.split('/')), 'utf8'));
  const pinDocs = {
    rest: parse(lf(readFileSync(path.join(ROOT, ...FILES.restSpec.split('/')), 'utf8'))),
    ws: parse(lf(readFileSync(path.join(ROOT, ...FILES.wsSpec.split('/')), 'utf8'))),
  };
  const used = usedByCafai();
  let resolved;
  try {
    resolved = await targets();
  } catch (error) {
    if (!(error instanceof GitHubError)) throw error;
    return { code: 2, report: `# Decaid drift watch\n\nNot run: ${error.message}.\n` };
  }
  const results = [];
  for (const target of resolved) {
    try {
      results.push(await checkTarget(target, { pin, pinDocs, used, fetchSpecs, compare, keep }));
    } catch (error) {
      if (!(error instanceof GitHubError)) throw error;
      results.push({ ...target, unreachable: error.message, files: [] });
    }
  }
  // A failed check wins over a version GitHub could not serve; 2 only when nothing was checked.
  const exitCode = results.some(failedTarget) ? 1 : results.every(unreachableTarget) ? 2 : 0;
  return { code: exitCode, report: formatReport({ pin, results, now: now() }) };
}

/** This workflow run's page on GitHub, when running in Actions. */
function runUrlFromEnv() {
  const { GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repository, GITHUB_RUN_ID: run } = process.env;
  return server && repository && run ? `${server}/${repository}/actions/runs/${run}` : null;
}

function usage() {
  console.error('Usage: node scripts/decaid-watch.mjs [--report <file>] [--issue <file>] [--keep]');
  process.exit(3);
}

function option(args, name) {
  const at = args.indexOf(name);
  if (at < 0) return null;
  const value = args[at + 1];
  if (!value || value.startsWith('--')) usage();
  return value;
}

async function main(args) {
  const reportFile = option(args, '--report');
  const issueFile = option(args, '--issue');
  let outcome;
  try {
    outcome = await runWatch({ keep: args.includes('--keep') });
  } catch (error) {
    // A broken watch is not a Decaid change: exit 3, so the workflow files no issue.
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exit(3);
  }
  console.log(outcome.report);
  if (reportFile) writeFileSync(reportFile, `${outcome.report}\n`);
  if (issueFile) writeFileSync(issueFile, `${issueBody(outcome.report, { runUrl: runUrlFromEnv() })}\n`);
  process.exit(outcome.code);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main(process.argv.slice(2));
