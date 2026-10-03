// SPDX-License-Identifier: GPL-3.0-only
// Derived from Crema web/src/advice/parse.ts (https://github.com/yarneo/crema @ 628cd714),
// Copyright (C) 2026 Yarden (yarneo). Modified for CafAI: only the JSON extraction and number coercion helpers.

/**
 * Forgiving readers for model text, kept as a fallback: CafAI's coach answers
 * through strict tools, but a reply that puts JSON in plain text (fences,
 * preamble, trailing chatter) can still be recovered without an error.
 */

/**
 * Pull the first balanced JSON object out of arbitrary reply text.
 *
 * Ported from the Tcl `extract_json`: scan from the first brace tracking depth,
 * while ignoring braces inside strings and honouring backslash escapes. This
 * handles markdown fences, leading prose and trailing chatter without needing
 * to special-case any of them.
 */
export function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  return null;
}

/**
 * Read a number from whatever shape it arrived in.
 *
 * Accepts a real number, or a string carrying one. Unicode minus and en-dash
 * are normalised because models emit them in place of ASCII "-", and a stray
 * unit suffix ("18g", "93 C") is tolerated. Anything else is null.
 */
export function coerceNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;

  const normalised = value.trim().replace(/[−–—]/g, '-');
  const match = /^[+-]?\d*\.?\d+/.exec(normalised);
  if (!match) return null;

  const parsed = Number.parseFloat(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}
