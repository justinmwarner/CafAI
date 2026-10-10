/**
 * Decaid's pinned specs as runtime validators (spec 4.2 and 4.4).
 *
 * The REST spec is OpenAPI 3.0 and the WebSocket spec AsyncAPI 3 with
 * schemas in the same dialect, so both are converted to JSON Schema draft-07
 * for ajv: `nullable` becomes a null type (around a $ref, an if/else, so an
 * object that fails reports its own problems rather than "must be null"),
 * draft-04 boolean exclusiveMinimum/Maximum become numbers, and $refs point
 * at the converted #/components/schemas. Every converted schema keeps its
 * spec location in `$comment`, which is how a problem is matched against the
 * exceptions in drift.ts: ajv's own schemaPath changes with how it compiled
 * a $ref.
 *
 * Used by mock/decaid/contract.test.ts and the tests against a real Decaid
 * (src/api/live). Node only.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';
import { SPEC_EXCEPTIONS, type SpecException } from './drift.ts';

export interface SpecValidator {
  /** Problems with a reply, as "path: message" strings; [] when valid. Skips the exceptions in drift.ts. */
  response(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, status: number, body: unknown): string[];
  /** Problems with a request body. */
  request(method: 'POST' | 'PUT', path: string, body: unknown): string[];
  /** Problems with a WebSocket frame on a channel ("ws/v1/machine/snapshot"). */
  frame(channel: string, frame: unknown): string[];
}

/** The vendored specs of the pin. */
export const SPEC_DIR = fileURLToPath(new URL('./spec/', import.meta.url));

const REST_FILE = 'rest_v1.yml';
const WS_FILE = 'websocket_v1.yml';
const REST_ID = 'decaid-rest';
const WS_ID = 'decaid-ws';
const JSON_TYPE = 'application/json';
const NULLABLE_MARK = ' (or null)';

type Doc = Record<string, unknown>;

function isObject(value: unknown): value is Doc {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function child(value: unknown, ...keys: string[]): unknown {
  let node = value;
  for (const key of keys) node = isObject(node) ? node[key] : undefined;
  return node;
}

/** JSON pointer escaping for a key in a spec location. */
function escapeKey(key: string): string {
  return key.replace(/~/g, '~0').replace(/\//g, '~1');
}

const SCHEMA_KEYS = new Set(['items', 'additionalProperties', 'not', 'if', 'then', 'else', 'contains', 'propertyNames']);
const SCHEMA_LIST_KEYS = new Set(['allOf', 'anyOf', 'oneOf']);
const SCHEMA_MAP_KEYS = new Set(['properties', 'patternProperties']);
/** OpenAPI keywords JSON Schema does not have (or that only annotate). */
const DROPPED_KEYS = new Set(['nullable', 'example', 'examples', 'deprecated', 'discriminator', 'xml', 'externalDocs']);

/** One OpenAPI 3.0 schema as JSON Schema draft-07; `at` is its spec location, `refBase` the $id its refs point into. */
export function toJsonSchema(node: unknown, at: string, refBase: string): unknown {
  if (!isObject(node)) return node;
  const out: Doc = { $comment: at };
  for (const [key, value] of Object.entries(node)) {
    if (DROPPED_KEYS.has(key) || key.startsWith('x-')) continue;
    if (key === '$ref' && typeof value === 'string') {
      out.$ref = value.replace(/^#\/components\/schemas\//, `${refBase}#/definitions/`);
    } else if (SCHEMA_KEYS.has(key) && isObject(value)) {
      out[key] = toJsonSchema(value, `${at}/${key}`, refBase);
    } else if (SCHEMA_LIST_KEYS.has(key) && Array.isArray(value)) {
      out[key] = value.map((item, index) => toJsonSchema(item, `${at}/${key}/${index}`, refBase));
    } else if (SCHEMA_MAP_KEYS.has(key) && isObject(value)) {
      out[key] = Object.fromEntries(
        Object.entries(value).map(([name, schema]) => [name, toJsonSchema(schema, `${at}/${key}/${escapeKey(name)}`, refBase)]),
      );
    } else {
      out[key] = value;
    }
  }
  // OpenAPI 3.0 keeps draft-04's boolean exclusiveMinimum/Maximum; draft-07 wants the bound itself.
  for (const [exclusive, bound] of [
    ['exclusiveMinimum', 'minimum'],
    ['exclusiveMaximum', 'maximum'],
  ] as const) {
    if (out[exclusive] === true && typeof out[bound] === 'number') {
      out[exclusive] = out[bound];
      delete out[bound];
    } else if (typeof out[exclusive] === 'boolean') {
      delete out[exclusive];
    }
  }
  if (node.nullable !== true) return out;
  if (typeof out.type === 'string' && !('$ref' in out) && !out.allOf && !out.anyOf && !out.oneOf) {
    out.type = [out.type, 'null'];
    if (Array.isArray(out.enum) && !out.enum.includes(null)) out.enum = [...out.enum, null];
    return out;
  }
  return { $comment: at + NULLABLE_MARK, if: { type: 'null' }, else: out };
}

function definitions(doc: Doc, file: string, refBase: string): Doc {
  const schemas = child(doc, 'components', 'schemas');
  if (!isObject(schemas)) throw new Error(`${file} has no components.schemas`);
  return Object.fromEntries(
    Object.entries(schemas).map(([name, schema]) => [name, toJsonSchema(schema, `${file}#/components/schemas/${escapeKey(name)}`, refBase)]),
  );
}

/** Spec templates ("/api/v1/shots/{id}") against a concrete path, literal segments first. */
interface Template {
  template: string;
  segments: string[];
  literals: number;
}

function templates(addresses: string[]): Template[] {
  return addresses.map((template) => {
    const segments = template.split('/');
    return { template, segments, literals: segments.filter((segment) => !/^\{.+\}$/.test(segment)).length };
  });
}

function matches(candidates: Template[], concrete: string): Template[] {
  const segments = concrete.split('/');
  return candidates
    .filter(
      ({ segments: wanted }) =>
        wanted.length === segments.length &&
        wanted.every((segment, index) => segment === segments[index] || (/^\{.+\}$/.test(segment) && segments[index] !== '')),
    )
    .sort((a, b) => b.literals - a.literals);
}

/** "/api/v1/x?y=1" or a full URL to "/api/v1/x". */
function pathOnly(path: string): string {
  const withoutOrigin = /^[a-z]+:\/\//i.test(path) ? new URL(path).pathname : path;
  return withoutOrigin.split(/[?#]/)[0] ?? '';
}

/** "/measurements/3/machine/timestamp" to "measurements[3].machine.timestamp". */
function fieldPath(pointer: string, extra?: string): string {
  const parts = pointer
    .split('/')
    .slice(1)
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
  if (extra !== undefined) parts.push(extra);
  let out = '';
  for (const part of parts) out += /^\d+$/.test(part) ? `[${part}]` : out === '' ? part : `.${part}`;
  return out === '' ? '(root)' : out;
}

function describeError(error: ErrorObject): string {
  const params = error.params as Record<string, unknown>;
  switch (error.keyword) {
    case 'required':
      return `${fieldPath(error.instancePath, String(params.missingProperty))}: missing`;
    case 'additionalProperties':
      return `${fieldPath(error.instancePath, String(params.additionalProperty))}: not in the spec`;
    case 'enum':
      return `${fieldPath(error.instancePath)}: ${JSON.stringify(error.data)} is not one of ${(params.allowedValues as unknown[]).join(', ')}`;
    case 'format':
      return `${fieldPath(error.instancePath)}: ${JSON.stringify(error.data)} is not a ${String(params.format)}`;
    case 'type':
      return `${fieldPath(error.instancePath)}: must be ${String(params.type).split(',').join(' or ')}`;
    default:
      return `${fieldPath(error.instancePath)}: ${error.message ?? error.keyword}`;
  }
}

/** Where in the spec the failing keyword sits ("rest_v1.yml#/components/schemas/X/properties/y/type"). */
function specLocation(error: ErrorObject): string {
  const at = isObject(error.parentSchema) && typeof error.parentSchema.$comment === 'string' ? error.parentSchema.$comment : '?';
  return `${at}/${error.keyword}`;
}

function excused(error: ErrorObject, where: string, exceptions: readonly SpecException[]): boolean {
  const location = specLocation(error);
  const params = error.params as Record<string, unknown>;
  return exceptions.some(
    (exception) =>
      (exception.where === 'any' || exception.where === where) &&
      exception.keyword === error.keyword &&
      (!exception.schemaPath || exception.schemaPath.test(location)) &&
      (!exception.instancePath || exception.instancePath.test(error.instancePath)) &&
      (!exception.params || Object.entries(exception.params).every(([key, value]) => params[key] === value)) &&
      (!exception.values || exception.values.some((value) => Object.is(value, error.data))) &&
      (!exception.valueMatches || (typeof error.data === 'string' && exception.valueMatches.test(error.data))),
  );
}

/** Problems as sentences, a problem repeated across a list once with its count. */
function problems(errors: readonly ErrorObject[], where: string, exceptions: readonly SpecException[]): string[] {
  const counts = new Map<string, { text: string; count: number }>();
  for (const error of errors) {
    // The if/else around a nullable $ref only repeats what failed inside it.
    if (error.keyword === 'if' && specLocation(error).endsWith(`${NULLABLE_MARK}/if`)) continue;
    if (excused(error, where, exceptions)) continue;
    const text = describeError(error);
    const key = text.replace(/\[\d+\]/g, '[]');
    const seen = counts.get(key);
    if (seen) seen.count += 1;
    else counts.set(key, { text, count: 1 });
  }
  return [...counts.values()].map(({ text, count }) => (count > 1 ? `${text} (${count} times)` : text));
}

interface Operation {
  template: string;
  responses: Doc;
  requestBody: unknown;
}

/** Load both specs from `specDir` (default: the pin's, contract/decaid/spec). */
export function loadSpecValidator(specDir: string = SPEC_DIR, exceptions: readonly SpecException[] = SPEC_EXCEPTIONS): SpecValidator {
  const rest = parse(readFileSync(join(specDir, REST_FILE), 'utf8')) as Doc;
  const ws = parse(readFileSync(join(specDir, WS_FILE), 'utf8')) as Doc;

  const ajv = new Ajv({ strict: false, allErrors: true, verbose: true, logger: false });
  addFormats(ajv);
  ajv.addSchema({ $id: REST_ID, definitions: definitions(rest, REST_FILE, REST_ID) });
  ajv.addSchema({ $id: WS_ID, definitions: definitions(ws, WS_FILE, WS_ID) });

  const compiled = new Map<string, ValidateFunction>();
  const compile = (key: string, schema: unknown, at: string, refBase: string): ValidateFunction => {
    let validate = compiled.get(key);
    if (!validate) {
      validate = ajv.compile(toJsonSchema(schema, at, refBase) as object);
      compiled.set(key, validate);
    }
    return validate;
  };
  const run = (validate: ValidateFunction, body: unknown, where: string): string[] =>
    validate(body) ? [] : problems(validate.errors ?? [], where, exceptions);

  const paths = isObject(rest.paths) ? rest.paths : {};
  const restTemplates = templates(Object.keys(paths));
  const operation = (method: string, path: string): Operation | null => {
    for (const { template } of matches(restTemplates, pathOnly(path))) {
      const op = child(paths, template, method.toLowerCase());
      if (isObject(op)) return { template, responses: isObject(op.responses) ? op.responses : {}, requestBody: op.requestBody };
    }
    return null;
  };
  const opLocation = (template: string, method: string) => `${REST_FILE}#/paths/${escapeKey(template)}/${method.toLowerCase()}`;

  // Channel address -> the payload schemas Decaid pushes on it (AsyncAPI operations with action "receive").
  const received = new Map<string, string[]>();
  const deref = (ref: unknown): unknown =>
    typeof ref === 'string'
      ? ref
          .replace(/^#\//, '')
          .split('/')
          .reduce<unknown>((node, key) => child(node, key.replace(/~1/g, '/').replace(/~0/g, '~')), ws)
      : undefined;
  for (const op of Object.values(isObject(ws.operations) ? ws.operations : {})) {
    if (!isObject(op) || op.action !== 'receive') continue;
    const channel = deref(child(op, 'channel', '$ref'));
    const address = child(channel, 'address');
    if (typeof address !== 'string') continue;
    const messages = Array.isArray(op.messages)
      ? op.messages.map((message) => deref(child(message, '$ref')))
      : Object.values(isObject(child(channel, 'messages')) ? (child(channel, 'messages') as Doc) : {});
    const names = received.get(address) ?? [];
    for (const message of messages) {
      const resolved = isObject(message) && typeof message.$ref === 'string' ? deref(message.$ref) : message;
      const ref = child(resolved, 'payload', '$ref');
      const name = typeof ref === 'string' ? ref.replace(/^#\/components\/schemas\//, '') : null;
      if (name && !names.includes(name)) names.push(name);
    }
    received.set(address, names);
  }
  const channelTemplates = templates([...received.keys()]);

  return {
    response(method, path, status, body) {
      const op = operation(method, path);
      if (!op) return [`route: ${method} ${pathOnly(path)} is not in the spec`];
      const where = `${method} ${op.template}`;
      const code = String(status);
      const statusKey = code in op.responses ? code : `${code[0]}XX` in op.responses ? `${code[0]}XX` : 'default' in op.responses ? 'default' : null;
      if (statusKey === null) {
        const known = exceptions.some(
          (exception) => exception.keyword === 'status' && exception.status === status && (exception.where === 'any' || exception.where === where),
        );
        return known ? [] : [`status: ${status} is not in the spec for ${where} (it has ${Object.keys(op.responses).join(', ')})`];
      }
      const schema = child(op.responses, statusKey, 'content', JSON_TYPE, 'schema');
      if (schema === undefined) return [];
      const at = `${opLocation(op.template, method)}/responses/${statusKey}/content/application~1json/schema`;
      return run(compile(`${where} ${statusKey}`, schema, at, REST_ID), body, where);
    },

    request(method, path, body) {
      const op = operation(method, path);
      if (!op) return [`route: ${method} ${pathOnly(path)} is not in the spec`];
      const where = `${method} ${op.template}`;
      const schema = child(op.requestBody, 'content', JSON_TYPE, 'schema');
      if (schema === undefined) return [`body: ${where} takes no JSON body in the spec`];
      const at = `${opLocation(op.template, method)}/requestBody/content/application~1json/schema`;
      return run(compile(`${where} request`, schema, at, REST_ID), body, where);
    },

    frame(channel, frame) {
      const address = channel.replace(/^\//, '');
      const [match] = matches(channelTemplates, address);
      const names = match ? (received.get(match.template) ?? []) : [];
      if (!match || names.length === 0) return [`channel: ${address} is not in the spec`];
      let best: string[] | null = null;
      for (const name of names) {
        const at = `${WS_FILE}#/components/schemas/${escapeKey(name)}`;
        const found = run(compile(`ws ${name}`, { $ref: `#/components/schemas/${name}` }, at, WS_ID), frame, match.template);
        if (found.length === 0) return [];
        if (!best || found.length < best.length) best = found;
      }
      return best ?? [];
    },
  };
}
