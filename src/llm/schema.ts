/**
 * Zod schemas -> strict tool definitions, and zod validators with short error
 * text the model can act on.
 *
 * Strict tool use guarantees schema-valid tool input, but only for the subset
 * of JSON Schema it can compile: every object closed (`additionalProperties:
 * false`) with every key required, and no length, count or range constraints.
 * Those constraints are stripped here and restated in the node's description so
 * the model still knows them; zod enforces them when the input comes back.
 */
import { z } from 'zod';
import type { JsonSchema, ToolDefinition, ToolValidation } from './types.ts';

/** Constraints strict mode cannot enforce. Stripped and restated in the description. */
const STATED_CONSTRAINTS: readonly string[] = [
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minProperties',
  'maxProperties',
];

/** Dropped without a trace: zod still checks them, and in a description they are noise. */
const SILENT_DROPS: readonly string[] = [
  '$schema',
  '$id',
  '$comment',
  'pattern',
  'default',
  'examples',
  'readOnly',
  'writeOnly',
  'deprecated',
  'contentEncoding',
  'contentMediaType',
];

const SUPPORTED_FORMATS: readonly string[] = [
  'date-time',
  'time',
  'date',
  'duration',
  'email',
  'hostname',
  'uri',
  'ipv4',
  'ipv6',
  'uuid',
];

export function toToolDefinition(name: string, description: string, schema: z.ZodType): ToolDefinition {
  // `input` mode describes what the model must send, before any zod transform.
  const raw = z.toJSONSchema(schema, { io: 'input' }) as JsonSchema;
  return { name, description, inputSchema: strictify(raw, name, '$') };
}

function fail(tool: string, path: string, problem: string): never {
  throw new Error(`Tool ${tool} at ${path}: ${problem} (not supported in strict tool schemas).`);
}

function isSchema(value: unknown): value is JsonSchema {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function strictifyMap(value: unknown, tool: string, path: string): Record<string, JsonSchema> {
  if (!isSchema(value)) fail(tool, path, 'expected a map of schemas');
  const out: Record<string, JsonSchema> = {};
  for (const [key, child] of Object.entries(value)) {
    if (!isSchema(child)) fail(tool, `${path}.${key}`, 'expected a schema');
    out[key] = strictify(child, tool, `${path}.${key}`);
  }
  return out;
}

function strictifyList(value: unknown, tool: string, path: string): JsonSchema[] {
  if (!Array.isArray(value)) fail(tool, path, 'expected a list of schemas');
  return value.map((child, i) => {
    if (!isSchema(child)) fail(tool, `${path}[${i}]`, 'expected a schema');
    return strictify(child, tool, `${path}[${i}]`);
  });
}

function strictify(node: JsonSchema, tool: string, path: string): JsonSchema {
  if ('prefixItems' in node) fail(tool, path, 'tuples ("prefixItems")');

  const out: JsonSchema = {};
  const stated: string[] = [];

  for (const [key, value] of Object.entries(node)) {
    if (SILENT_DROPS.includes(key)) continue;
    if (STATED_CONSTRAINTS.includes(key)) {
      stated.push(`${key}: ${JSON.stringify(value)}`);
      continue;
    }
    switch (key) {
      case 'type':
      case 'enum':
      case 'const':
      case 'description':
      case 'title':
      case '$ref':
        out[key] = value;
        break;
      case 'format':
        if (typeof value === 'string' && SUPPORTED_FORMATS.includes(value)) out.format = value;
        break;
      case 'properties':
        out.properties = strictifyMap(value, tool, `${path}.properties`);
        break;
      case '$defs':
      case 'definitions':
        out[key] = strictifyMap(value, tool, `${path}.${key}`);
        break;
      case 'items':
        if (!isSchema(value)) fail(tool, `${path}.items`, 'items must be one schema');
        out.items = strictify(value, tool, `${path}.items`);
        break;
      case 'anyOf':
      case 'oneOf':
        // Branches of a zod union are disjoint in practice, so anyOf (supported)
        // means the same as oneOf (not supported).
        out.anyOf = strictifyList(value, tool, `${path}.${key}`);
        break;
      case 'allOf':
        out.allOf = strictifyList(value, tool, `${path}.allOf`);
        break;
      case 'required':
        // Recomputed below: strict mode wants every key listed.
        break;
      case 'additionalProperties':
        if (value !== false) fail(tool, path, 'additionalProperties other than false (records, loose objects)');
        break;
      default:
        fail(tool, path, `the keyword "${key}"`);
    }
  }

  if (out.type === 'object' || out.properties !== undefined) {
    const properties = (out.properties ?? {}) as Record<string, JsonSchema>;
    out.properties = properties;
    out.required = Object.keys(properties);
    out.additionalProperties = false;
  }

  if (stated.length > 0) {
    const hint = `{${stated.join(', ')}}`;
    out.description = typeof out.description === 'string' && out.description !== '' ? `${out.description} ${hint}` : hint;
  }

  if (Array.isArray(out.type)) return splitTypeArray(out);
  return out;
}

/**
 * `{type: ["number", "null"]}` -> `{anyOf: [{type: "number"}, {type: "null"}]}`.
 * anyOf with a null branch is the documented way to say "nullable" in strict
 * mode; type arrays are not.
 */
function splitTypeArray(node: JsonSchema): JsonSchema {
  const { type, description, title, ...rest } = node;
  const types = type as unknown[];
  const out: JsonSchema = {
    anyOf: types.map((t) => (t === 'null' ? { type: 'null' } : { type: t, ...rest })),
  };
  if (description !== undefined) out.description = description;
  if (title !== undefined) out.title = title;
  return out;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** More than this many problems at once is noise; the model fixes the first few and retries. */
const MAX_ISSUES = 6;

/**
 * A validator for `RunnerTool.validate`. Invalid input comes back as one short
 * line per problem ("options: expected at most 5 items"), which the runner
 * hands to the model as an is_error tool result.
 */
export function zodValidator(schema: z.ZodType): (input: unknown) => ToolValidation {
  return (input) => {
    const result = schema.safeParse(input, { reportInput: true });
    if (result.success) return { ok: true, value: result.data };
    return { ok: false, error: describeIssues(result.error.issues) };
  };
}

export function describeIssues(issues: readonly z.core.$ZodIssue[]): string {
  const lines = issues.slice(0, MAX_ISSUES).map((issue) => `${formatPath(issue.path)}: ${describeProblem(issue)}`);
  if (issues.length > MAX_ISSUES) lines.push(`and ${issues.length - MAX_ISSUES} more`);
  return lines.join('; ');
}

function formatPath(path: readonly PropertyKey[]): string {
  if (path.length === 0) return 'input';
  let out = '';
  for (const part of path) {
    if (typeof part === 'number') out += `[${part}]`;
    else out += out === '' ? String(part) : `.${String(part)}`;
  }
  return out;
}

function typeName(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number' && Number.isNaN(value)) return 'NaN';
  return typeof value;
}

function plural(n: number, unit: string): string {
  return n === 1 ? unit : `${unit}s`;
}

function describeBound(
  side: 'most' | 'least',
  limit: number | bigint,
  origin: string,
  inclusive: boolean,
  exact: boolean,
): string {
  const n = Number(limit);
  const relation = exact ? 'exactly' : inclusive ? `at ${side}` : side === 'most' ? 'less than' : 'more than';
  const unit =
    origin === 'string' ? ` ${plural(n, 'character')}` : origin === 'array' || origin === 'set' ? ` ${plural(n, 'item')}` : '';
  return `expected ${relation} ${n}${unit}`;
}

function describeProblem(issue: z.core.$ZodIssue): string {
  switch (issue.code) {
    case 'too_big':
      return describeBound('most', issue.maximum, issue.origin, issue.inclusive !== false, issue.exact === true);
    case 'too_small':
      return describeBound('least', issue.minimum, issue.origin, issue.inclusive !== false, issue.exact === true);
    case 'invalid_type':
      // A missing key carries no input at all.
      return issue.input === undefined ? 'required' : `expected ${issue.expected}, got ${typeName(issue.input)}`;
    case 'invalid_value':
      return issue.values.length === 1
        ? `expected ${JSON.stringify(issue.values[0])}`
        : `expected one of ${issue.values.map((v) => JSON.stringify(v)).join(', ')}`;
    case 'unrecognized_keys':
      return `unexpected ${plural(issue.keys.length, 'key')} ${issue.keys.map((k) => JSON.stringify(k)).join(', ')}`;
    case 'invalid_format':
      return `expected a valid ${issue.format}`;
    case 'not_multiple_of':
      return `expected a multiple of ${String(issue.divisor)}`;
    case 'invalid_union':
      return 'does not match any allowed shape';
    default:
      return issue.message;
  }
}
