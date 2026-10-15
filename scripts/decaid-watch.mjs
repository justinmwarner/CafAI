#!/usr/bin/env node
// Would the newest Decaid break CafAI? (spec 4.3)
//
// For Decaid's latest release and its main branch: when the specs differ from
// the pin's, generate their types into a temporary folder, run the contract
// typecheck with the #decaid aliases pointed there, run the mock contract test
// (fixtures and the mock's replies and frames) against the new spec, compare
// the spec's channel map with the channels CafAI opens (CHANNELS), and diff
// the specs: operations added or removed (and whether CafAI calls them), and
// fields added, removed or retyped in the schemas CafAI reads or writes. What
// can break CafAI (a removal or a retype in what it calls, opens or reads)
// fails the check like a failed typecheck. Then list the Decaid files changed
// since the pin that CafAI depends on (GitHub's compare API, filtered by
// WATCH), as "read these".
//
// Prints a markdown report (--report <file> writes it too; --issue <file>
// writes it cut to fit a GitHub issue). Each Decaid version is checked on its
// own. The exit code is the first that applies:
//   1  a check failed, a spec file included (Decaid no longer serves it);
//   2  the watch could not look at everything: GitHub could not serve a
//      version, or could not list the files changed since the pin;
//   4  files CafAI depends on changed since the pin (the specs among them, if
//      their changes are additive) and every check passes: read them;
//   0  nothing CafAI depends on changed.
// An exception Decaid has fixed (`stale`) is reported for when the pin moves,
// not failed. Exit 3: the watch itself broke.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import {
  AGENT_DOCS,
  CHILD_TIMEOUT_MS,
  FILES,
  GitHubError,
  REPO,
  ROOT,
  SpecMissingError,
  channelDrift,
  childOutput,
  contractTypecheck,
  fetchSpecs as fetchSpecsFromGitHub,
  generateRest,
  generateWs,
  github,
  lf,
  sha256,
  specAddress,
  specChannels,
} from './decaid-contract.mjs';

/**
 * The Decaid paths CafAI depends on: the specs, the skin docs, the handlers
 * and models it reads, the plugins it uses, and the agent docs its agents read.
 */
export const WATCH = [
  'assets/api/',
  'doc/Skins.md',
  'doc/Api.md',
  'lib/src/services/webserver/',
  'lib/src/models/data/',
  'lib/src/models/device/',
  // Sleep and wake (presence): the schedules and their keep-awake window, what fires them, the minutes' range,
  // the defaults, and Decaid's own page, which hides the schedules while its switch is off.
  'lib/src/models/wake_schedule.dart',
  'lib/src/models/keep_awake_occurrence.dart',
  'lib/src/controllers/presence_controller.dart',
  'lib/src/settings/sleep_timeout_preference.dart',
  'lib/src/settings/settings_controller.dart',
  'lib/src/settings/presence_settings_page.dart',
  // The care reminders (D-CARE-3, D-CARE-4): which runs Decaid saves as shots (none for a cleaning profile),
  // when a steam record opens and closes, and what the shot and steam lists cost Decaid to read.
  'lib/src/controllers/de1_state_manager.dart',
  'lib/src/controllers/steam_sequencer.dart',
  'lib/src/services/database/mappers/',
  'lib/src/skin_feature/',
  'lib/src/webui_support/',
  'assets/plugins/visualizer.reaplugin/',
  'assets/plugins/time-to-ready.reaplugin/',
  'assets/plugins/settings.reaplugin/',
  // DYE2 is not in Decaid's tree (assets/plugins/dye2.reaplugin/ is gitignored):
  // this script downloads the release Decaid bundles, pinned by version and sha256.
  'scripts/fetch_dye2_plugin.sh',
  // contract/decaid keeps them at the pin (D145); npm run decaid:update brings their changes.
  ...AGENT_DOCS.map((doc) => doc.upstream),
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
    for (const [, route, method] of text.matchAll(/(?:Res|Body|Statuses|PathParams|Query|Lacks|Documents)<\s*'(\/api\/v1\/[^']*)',\s*'(get|put|post|delete|patch)'/g)) {
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

/**
 * Leaf differences between two stripped schemas, each with `keys` (from the
 * schema's name down) and a line: "+ path = new", "- path (was old)" or
 * "~ path: old -> new". Arrays (enum, required, allOf) are leaves.
 */
function leafDiff(a, b, at, out) {
  if (same(a, b)) return out;
  if (isObject(a) && isObject(b)) {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const keys = [...at, key];
      if (!(key in a)) out.push({ keys, line: `+ ${keys.join('.')} = ${JSON.stringify(b[key]).slice(0, 160)}` });
      else if (!(key in b)) out.push({ keys, line: `- ${keys.join('.')} (was ${JSON.stringify(a[key]).slice(0, 160)})` });
      else leafDiff(a[key], b[key], keys, out);
    }
  } else {
    out.push({ keys: at, line: `~ ${at.join('.')}: ${JSON.stringify(a)?.slice(0, 120)} -> ${JSON.stringify(b)?.slice(0, 120)}` });
  }
  return out;
}

/** Keywords whose value is a schema again: the keys below them are keywords too. */
const SUBSCHEMAS = ['items', 'additionalProperties', 'not'];
/** Keywords whose change retypes a value. allOf, oneOf and anyOf are arrays, so leafDiff reports them whole. */
const RETYPING = ['type', '$ref', 'nullable', 'allOf', 'oneOf', 'anyOf', 'items'];

/**
 * Whether a schema difference can break CafAI's readers: a property removed
 * (or a whole `properties` or `items`), or a value retyped. Enum, format,
 * required and description changes are not: the contract typecheck covers the
 * enums and required fields CafAI depends on. The key after `properties` is a
 * property's name, not a keyword; keys under any other value (a default, an
 * x- extension) are neither.
 */
function breaks(sign, keys) {
  // The schema itself replaced by something that is not an object.
  if (keys.length === 1) return true;
  let at = 'keyword';
  for (const key of keys.slice(1, -1)) {
    if (at === 'name') at = 'keyword';
    else if (at === 'keyword') at = key === 'properties' || key === 'patternProperties' ? 'name' : SUBSCHEMAS.includes(key) ? 'keyword' : 'value';
  }
  // A property removed, or its schema replaced by something that is not an object; an added one breaks nothing.
  if (at === 'name') return sign !== '+';
  if (at === 'value') return false;
  const last = keys.at(-1);
  return RETYPING.includes(last) || (sign === '-' && last === 'properties');
}

function operationsOf(doc) {
  const out = {};
  for (const [route, item] of Object.entries(doc.paths ?? {})) {
    for (const [method, op] of Object.entries(item ?? {})) if (METHODS.includes(method)) out[`${method.toUpperCase()} ${route}`] = op;
  }
  return out;
}

/** An operation's parameters by "in name": the path item's and the operation's own (which win), $refs resolved. */
function parametersOf(doc, operation) {
  const [method, route] = operation.split(' ');
  const item = doc.paths?.[route] ?? {};
  const resolve = (parameter) =>
    typeof parameter?.$ref === 'string' && parameter.$ref.startsWith('#/components/parameters/')
      ? doc.components?.parameters?.[parameter.$ref.slice('#/components/parameters/'.length)]
      : parameter;
  const out = {};
  for (const parameter of [...(item.parameters ?? []), ...(item[method.toLowerCase()]?.parameters ?? [])].map(resolve)) {
    if (parameter?.name) out[`${parameter.in} ${parameter.name}`] = parameter;
  }
  return out;
}

/** What a parameter's value must be: its schema's type, $ref and items. */
function parameterShape(parameter) {
  const { type, $ref, items } = parameter.schema ?? {};
  return JSON.stringify(strip({ type, $ref, items }));
}

/** Parameter changes that break a call CafAI makes: one removed or renamed, retyped, or added as required. */
function parameterChanges(before, after, operations) {
  const out = [];
  for (const operation of operations) {
    const was = parametersOf(before, operation);
    const now = parametersOf(after, operation);
    for (const [key, parameter] of Object.entries(was)) {
      if (!(key in now)) out.push(`- parameter ${key} of ${operation}`);
      else if (parameterShape(parameter) !== parameterShape(now[key])) {
        out.push(`~ parameter ${key} of ${operation}: ${parameterShape(parameter)} -> ${parameterShape(now[key])}`);
      }
    }
    for (const [key, parameter] of Object.entries(now)) {
      if (!(key in was) && parameter.required === true) out.push(`+ parameter ${key} of ${operation} (required)`);
    }
  }
  return out;
}

/** Schema names reachable through $refs from `roots`, also through other components (a parameter, a response). */
function reachable(doc, roots) {
  const names = new Set();
  const seen = new Set();
  const visit = (node) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!isObject(node)) return;
    const ref = typeof node.$ref === 'string' ? /^#\/components\/([^/]+)\/(.+)$/.exec(node.$ref) : null;
    if (ref && !seen.has(node.$ref)) {
      seen.add(node.$ref);
      if (ref[1] === 'schemas') names.add(ref[2]);
      visit(doc.components?.[ref[1]]?.[ref[2]]);
    }
    Object.values(node).forEach(visit);
  };
  roots.forEach(visit);
  return names;
}

/** The schemas CafAI uses: reachable from the operations it calls, and from what Decaid pushes on the channels it opens. */
function usedSchemas(docs, used) {
  const restOps = operationsOf(docs.rest);
  const rest = reachable(docs.rest, used.operations.map((op) => restOps[op]).filter(Boolean));
  const map = specChannels(docs.ws);
  const addresses = new Set(used.channels.map((channel) => specAddress(Object.keys(map), channel)));
  const roots = Object.entries(map)
    .filter(([address]) => addresses.has(address))
    .flatMap(([, entry]) => (entry.receive ?? []).map((name) => ({ $ref: `#/components/schemas/${name}` })));
  return { rest, websocket: reachable(docs.ws, roots) };
}

/**
 * What changed between two spec pairs, as far as CafAI is concerned.
 * `breaking` is what can break CafAI: an operation it calls or a channel it
 * opens removed, a parameter of a call it makes removed, renamed, retyped or
 * added as required, a schema it uses removed, and a property of one removed
 * or retyped (breaks()).
 */
export function diffSpecs(before, after, used) {
  const opsBefore = operationsOf(before.rest);
  const opsAfter = operationsOf(after.rest);
  const added = Object.keys(opsAfter).filter((op) => !(op in opsBefore));
  const removed = Object.keys(opsBefore).filter((op) => !(op in opsAfter));
  const removedUsed = removed.filter((op) => used.operations.includes(op));
  const kept = used.operations.filter((op) => op in opsBefore && op in opsAfter);
  const changedUsed = kept.filter((op) => !same(strip(opsBefore[op]), strip(opsAfter[op])));

  const schemas = [];
  const breakingSchemas = [];
  const namesBefore = usedSchemas(before, used);
  const namesAfter = usedSchemas(after, used);
  for (const [label, key] of [['rest', 'rest'], ['websocket', 'ws']]) {
    const all = [...new Set([...namesBefore[label], ...namesAfter[label]])].sort();
    for (const name of all) {
      const a = before[key].components?.schemas?.[name];
      const b = after[key].components?.schemas?.[name];
      if (a === undefined) schemas.push(`+ ${label} ${name} (new schema)`);
      else if (b === undefined) {
        schemas.push(`- ${label} ${name} (removed)`);
        breakingSchemas.push(`- ${label} ${name} (removed)`);
      } else {
        for (const { keys, line } of leafDiff(strip(a), strip(b), [name], [])) {
          const entry = `${line[0]} ${label} ${line.slice(2)}`;
          schemas.push(entry);
          if (breaks(line[0], keys)) breakingSchemas.push(entry);
        }
      }
    }
  }

  const addressesBefore = Object.keys(specChannels(before.ws));
  const addressesAfter = Object.keys(specChannels(after.ws));
  const channelsRemoved = addressesBefore.filter((address) => !addressesAfter.includes(address));
  // A channel CafAI opens is gone when no address serves it any more: a template that only renamed a parameter still does.
  const channelsRemovedUsed = used.channels.filter(
    (channel) => specAddress(addressesBefore, channel) !== null && specAddress(addressesAfter, channel) === null,
  );
  return {
    operations: { added, removed, removedUsed, changedUsed },
    schemas,
    channels: {
      added: addressesAfter.filter((address) => !addressesBefore.includes(address)),
      removed: channelsRemoved,
      removedUsed: channelsRemovedUsed,
    },
    breaking: [
      ...removedUsed.map((op) => `- operation ${op} (removed)`),
      ...channelsRemovedUsed.map((channel) => `- channel ${channel} (removed)`),
      ...parameterChanges(before.rest, after.rest, kept),
      ...breakingSchemas,
    ],
  };
}

/**
 * vitest's json report (its text, or null when there is none) as the mock
 * check's verdict: ok when at least one test passed and none failed. A -t
 * filter that matches no test name skips every test, and vitest exits 0.
 */
export function vitestRan(text) {
  let report = null;
  try {
    report = text === null ? null : JSON.parse(text);
  } catch {
    // An unreadable report is no report.
  }
  if (typeof report?.numPassedTests !== 'number') return { ok: false, problem: 'vitest ran no test: it wrote no report' };
  // Failed tests are a failed check, and the output names them.
  if (report.numFailedTests > 0) return { ok: false, problem: null };
  if (report.numPassedTests === 0) {
    return {
      ok: false,
      problem: `vitest ran no test: ${report.numPassedTests} passed, ${report.numPendingTests} skipped (does the -t filter still match the test names?)`,
    };
  }
  return { ok: true, problem: null };
}

/**
 * The mock contract test (fixtures, the mock's replies and frames) against the
 * specs in `specDir`. vitest also writes its json report to `reportFile`,
 * which must show a passed test.
 */
function runMockContract(specDir, reportFile) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('VITEST')));
  const vitest = path.join(ROOT, 'node_modules', 'vitest', 'vitest.mjs');
  const result = spawnSync(
    process.execPath,
    [
      vitest,
      'run',
      'mock/decaid/contract.test.ts',
      '-t',
      'the fixtures|the mock against the spec',
      '--reporter=default',
      '--reporter=json',
      `--outputFile.json=${reportFile}`,
    ],
    { cwd: ROOT, env: { ...env, DECAID_SPEC_DIR: specDir, FORCE_COLOR: '0', NO_COLOR: '1' }, encoding: 'utf8', timeout: CHILD_TIMEOUT_MS },
  );
  const output = childOutput(result, 'vitest');
  const ran = vitestRan(existsSync(reportFile) ? readFileSync(reportFile, 'utf8') : null);
  const failures = output
    .split(/\r?\n/)
    .filter((line) => /^\s*\+\s+"/.test(line) || /^\s*(FAIL|×)\s/.test(line))
    .map((line) => line.trim());
  const problems = [...(ran.problem ? [ran.problem] : []), ...(failures.length > 0 ? failures : output.split(/\r?\n/).slice(-20))];
  return { ok: result.status === 0 && ran.ok, problems: problems.slice(0, 40) };
}

const failedTarget = (result) =>
  Boolean(
    result.missingSpec ||
      result.generationError ||
      result.diff?.breaking.length > 0 ||
      result.channelDrift?.length > 0 ||
      (result.typecheck && (result.typecheck.unexpected.length > 0 || result.typecheck.other.length > 0)) ||
      (result.mock && !result.mock.ok),
  );

/** A version GitHub could not serve. */
const unreachableTarget = (result) => Boolean(result.unreachable);

/** A version the watch could not look at fully: GitHub could not serve it, or could not list its changed files. */
const blindTarget = (result) => Boolean(result.unreachable || result.filesError);

/** A version on which files CafAI depends on changed since the pin: the specs, or other files under WATCH. */
const filesChanged = (result) => Boolean(result.specsChanged || result.files?.length > 0);

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
      const docs = { rest: parse(lf(restText)), ws: parse(lf(wsText)) };
      result.diff = diffSpecs(pinDocs, docs, used);
      result.channelDrift = channelDrift(docs.ws);
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
    result.mock = runMockContract(specDir, path.join(dir, 'vitest.json'));
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
  if (failedTarget(result)) return 'a check failed';
  const specs = result.specsChanged ? 'specs changed: additive, every check passes' : 'no spec change';
  if (result.filesError) return `could not be checked: ${specs}, but the changed files could not be listed`;
  if (filesChanged(result)) return `files CafAI depends on changed (${specs})`;
  return 'nothing CafAI depends on changed';
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
    if (result.channelDrift.length > 0) {
      lines.push('- Channels CafAI opens: **the spec differs from CHANNELS** (scripts/decaid-contract.mjs).');
      for (const entry of result.channelDrift) lines.push(`  - ${code(entry)}`);
    } else {
      lines.push('- Channels CafAI opens: the spec sends the frames CafAI expects.');
    }
    const { operations, channels, schemas, breaking } = result.diff;
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
    if (breaking.length > 0) {
      lines.push('', '### Breaking: removed or retyped in what CafAI calls, opens or reads', '');
      for (const entry of breaking) lines.push(`- ${code(entry)}`);
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
  // Decaid changes its agent docs often; they go last, so they do not bury the code.
  const isAgentDoc = (file) => AGENT_DOCS.some((doc) => file.filename.startsWith(doc.upstream));
  const entry = (file) => `- ${code(file.filename)} (${file.status}, +${file.additions} -${file.deletions})`;
  for (const file of result.files.filter((file) => !isAgentDoc(file))) lines.push(entry(file));
  const docs = result.files.filter(isAgentDoc);
  if (docs.length > 0) {
    lines.push('', "#### Decaid's agent docs (contract/decaid/skill/ and doc/ have them at the pin; npm run decaid:update brings these)", '');
    for (const file of docs) lines.push(entry(file));
  }
  lines.push('');
  return lines;
}

export function formatReport({ pin, results, now }) {
  const lines = [
    '# Decaid drift watch',
    '',
    `Checked ${now.toISOString().slice(0, 16).replace('T', ' ')} UTC against the pin: Decaid ${pin.release ?? '(no tag)'} (${short(pin.commit)}). ` +
      'Exit 1 means a check failed; else 2 that the watch could not look at everything (GitHub could not serve a version, ' +
      'or list the files changed since the pin); else 4 that files CafAI depends on changed and every check passes; ' +
      'else 0 that nothing CafAI depends on changed.',
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
  const unlisted = results.filter((result) => !unreachableTarget(result) && result.filesError);
  if (unlisted.length > 0) {
    lines.push(
      `**Warning:** the files changed since the pin could not be listed for ` +
        `${unlisted.map((result) => `${result.name} (${result.filesError})`).join('; ')}.`,
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
  // The first that applies: a failed check, a partial look, changed files CafAI depends on.
  const exitCode = results.some(failedTarget) ? 1 : results.some(blindTarget) ? 2 : results.some(filesChanged) ? 4 : 0;
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
  // process.exit() after fetch() aborts Node 24 on Windows with a libuv
  // assertion (see leave() in bridge/cafai-bridge.mjs): set the exit code,
  // and let the event loop empty.
  let outcome;
  try {
    outcome = await runWatch({ keep: args.includes('--keep') });
  } catch (error) {
    // A broken watch is not a Decaid change: exit 3, so the workflow files no issue.
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exitCode = 3;
    return;
  }
  console.log(outcome.report);
  if (reportFile) writeFileSync(reportFile, `${outcome.report}\n`);
  if (issueFile) writeFileSync(issueFile, `${issueBody(outcome.report, { runUrl: runUrlFromEnv() })}\n`);
  process.exitCode = outcome.code;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main(process.argv.slice(2));
