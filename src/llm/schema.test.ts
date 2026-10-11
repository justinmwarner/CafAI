import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AskUserInput, ProposeTemplatesInput, SaveBagDetailsInput, TOOL_INPUTS } from '../coach/contract.ts';
import { toToolDefinition, zodValidator } from './schema.ts';

/** Keywords strict tool use accepts. Anything else in a tool schema is a 400 or a silent no-op. */
const ALLOWED_KEYWORDS = new Set([
  'type',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'anyOf',
  'allOf',
  'enum',
  'const',
  'description',
  'title',
  '$ref',
  '$defs',
  'format',
]);

type Node = Record<string, unknown>;

/** Visit every schema node (not property-name maps) with its JSON path. */
function walk(schema: unknown, visit: (node: Node, path: string) => void, path = '$'): void {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) return;
  const node = schema as Node;
  visit(node, path);
  if (typeof node.items === 'object') walk(node.items, visit, `${path}.items`);
  for (const key of ['anyOf', 'allOf'] as const) {
    const list = node[key];
    if (Array.isArray(list)) list.forEach((child, i) => walk(child, visit, `${path}.${key}[${i}]`));
  }
  for (const key of ['properties', '$defs'] as const) {
    const map = node[key];
    if (typeof map === 'object' && map !== null) {
      for (const [name, child] of Object.entries(map)) walk(child, visit, `${path}.${key}.${name}`);
    }
  }
}

describe('toToolDefinition', () => {
  it('returns the name, the description and an input schema without $schema', () => {
    const def = toToolDefinition('get_shot_summary', 'Summary of one shot.', z.object({ shot: z.string() }));
    expect(def).toEqual({
      name: 'get_shot_summary',
      description: 'Summary of one shot.',
      inputSchema: {
        type: 'object',
        properties: { shot: { type: 'string' } },
        required: ['shot'],
        additionalProperties: false,
      },
    });
  });

  it('makes every object strict, including ones nested in arrays and nullables', () => {
    const schema = z.object({
      list: z.array(z.object({ a: z.string(), b: z.boolean() })),
      maybe: z.object({ c: z.number() }).nullable(),
    });
    const { inputSchema } = toToolDefinition('t', 'd', schema);
    expect(inputSchema).toEqual({
      type: 'object',
      properties: {
        list: {
          type: 'array',
          items: {
            type: 'object',
            properties: { a: { type: 'string' }, b: { type: 'boolean' } },
            required: ['a', 'b'],
            additionalProperties: false,
          },
        },
        maybe: {
          anyOf: [
            {
              type: 'object',
              properties: { c: { type: 'number' } },
              required: ['c'],
              additionalProperties: false,
            },
            { type: 'null' },
          ],
        },
      },
      required: ['list', 'maybe'],
      additionalProperties: false,
    });
  });

  it('strips length, count and range constraints and states them in the description', () => {
    const schema = z.object({
      name: z.string().min(1).max(40).describe('Short bag name'),
      steps: z.number().min(0).max(5),
      tags: z.array(z.string().max(10)).min(2).max(5),
    });
    const { inputSchema } = toToolDefinition('t', 'd', schema);
    const properties = inputSchema.properties as Record<string, Node>;
    expect(properties.name).toEqual({ type: 'string', description: 'Short bag name {minLength: 1, maxLength: 40}' });
    expect(properties.steps).toEqual({ type: 'number', description: '{minimum: 0, maximum: 5}' });
    expect(properties.tags).toEqual({
      type: 'array',
      items: { type: 'string', description: '{maxLength: 10}' },
      description: '{minItems: 2, maxItems: 5}',
    });
  });

  it('turns nullable primitives into anyOf with null', () => {
    const schema = z.object({ value: z.number().nullable(), lever: z.string().nullable() });
    const properties = toToolDefinition('t', 'd', schema).inputSchema.properties as Record<string, Node>;
    expect(properties.value).toEqual({ anyOf: [{ type: 'number' }, { type: 'null' }] });
    expect(properties.lever).toEqual({ anyOf: [{ type: 'string' }, { type: 'null' }] });
  });

  it('keeps enums and supported string formats but drops regex patterns', () => {
    const schema = z.object({ level: z.enum(['light', 'dark']), mail: z.email() });
    const properties = toToolDefinition('t', 'd', schema).inputSchema.properties as Record<string, Node>;
    expect(properties.level).toEqual({ type: 'string', enum: ['light', 'dark'] });
    expect(properties.mail).toEqual({ type: 'string', format: 'email' });
  });

  it('is deterministic, so the cached prompt prefix stays byte-identical', () => {
    const a = JSON.stringify(toToolDefinition('ask_user', 'Ask.', AskUserInput));
    const b = JSON.stringify(toToolDefinition('ask_user', 'Ask.', AskUserInput));
    expect(a).toBe(b);
  });

  it('refuses shapes that strict tools cannot express instead of loosening them', () => {
    expect(() => toToolDefinition('t', 'd', z.object({ m: z.record(z.string(), z.number()) }))).toThrow(/strict/i);
    expect(() => toToolDefinition('t', 'd', z.object({ p: z.tuple([z.string(), z.number()]) }))).toThrow(/prefixItems/);
    expect(() => toToolDefinition('t', 'd', z.looseObject({ a: z.string() }))).toThrow(/additionalProperties/);
  });

  describe.each(Object.entries(TOOL_INPUTS))('contract tool %s', (name, schema) => {
    const { inputSchema } = toToolDefinition(name, 'description', schema);

    it('uses only keywords strict tool use supports', () => {
      walk(inputSchema, (node, path) => {
        for (const key of Object.keys(node)) {
          expect(ALLOWED_KEYWORDS.has(key), `${name} ${path}: unsupported keyword "${key}"`).toBe(true);
        }
        expect(Array.isArray(node.type), `${name} ${path}: type arrays are not allowed`).toBe(false);
      });
    });

    it('makes every object strict with every key required', () => {
      let objects = 0;
      walk(inputSchema, (node, path) => {
        if (node.type !== 'object') return;
        objects += 1;
        expect(node.additionalProperties, `${name} ${path}`).toBe(false);
        expect(node.required, `${name} ${path}`).toEqual(Object.keys(node.properties as Node));
      });
      expect(objects).toBeGreaterThan(0);
    });

    it('needed no key to be made required (the contract uses nullable, not optional)', () => {
      walk(z.toJSONSchema(schema, { io: 'input' }), (node, path) => {
        if (node.type !== 'object') return;
        expect(node.required ?? [], `${name} ${path}`).toEqual(Object.keys((node.properties ?? {}) as Node));
      });
    });
  });
});

describe('zodValidator', () => {
  it('returns the parsed value when the input is valid', () => {
    const validate = zodValidator(AskUserInput);
    expect(validate({ question: 'How did it taste?', options: ['  Sour ', 'Bitter'], multiSelect: false })).toEqual({
      ok: true,
      value: { question: 'How did it taste?', options: ['Sour', 'Bitter'], multiSelect: false },
    });
  });

  it('answers with one compact line per problem', () => {
    const validate = zodValidator(AskUserInput);
    expect(validate({ question: 'Q?', options: ['a', 'b', 'c', 'd', 'e', 'f'], multiSelect: false })).toEqual({
      ok: false,
      error: 'options: expected at most 5 items',
    });
  });

  it('joins several problems', () => {
    const result = zodValidator(AskUserInput)({ question: '', options: ['a', 'b'], multiSelect: 'no' });
    expect(result).toEqual({
      ok: false,
      error: 'question: expected at least 1 character; multiSelect: expected boolean, got string',
    });
  });

  it('names missing keys and lists the allowed values of an enum', () => {
    const result = zodValidator(SaveBagDetailsInput)({
      name: 'Kiambu AA',
      origin: null,
      roastLevel: 'very dark',
      process: null,
      notes: null,
    });
    expect(result).toEqual({
      ok: false,
      error: 'roaster: required; roastLevel: expected one of "light", "medium-light", "medium", "medium-dark", "dark"; roastDate: required',
    });
  });

  it('points into nested arrays', () => {
    const result = zodValidator(ProposeTemplatesInput)({
      suggestions: [
        { templateId: 'd-flow', confidence: 'high', reason: 'Fine.' },
        { templateId: 'londonium', confidence: 'low', reason: 'x'.repeat(241) },
      ],
    });
    expect(result).toEqual({ ok: false, error: 'suggestions[1].reason: expected at most 240 characters' });
  });

  it('caps a long list of problems', () => {
    const schema = z.object(Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((k) => [k, z.string()])));
    expect(zodValidator(schema)({})).toEqual({
      ok: false,
      error: 'a: required; b: required; c: required; d: required; e: required; f: required; and 2 more',
    });
  });

  it('reports numeric bounds and a wrong top-level shape', () => {
    const validate = zodValidator(z.object({ n: z.number().min(1).max(10) }));
    expect(validate({ n: 11 })).toEqual({ ok: false, error: 'n: expected at most 10' });
    expect(validate({ n: 0 })).toEqual({ ok: false, error: 'n: expected at least 1' });
    expect(validate(null)).toEqual({ ok: false, error: 'input: expected object, got null' });
    expect(validate('{"n":1}')).toEqual({ ok: false, error: 'input: expected object, got string' });
  });
});
