/**
 * Pure redaction helpers (no storage access), shared by the Decaid backup, the
 * export and the coach engine.
 */

export const REDACTED = '[redacted]';

/**
 * Anything shaped like an Anthropic API key: "sk-ant-" and a run of key
 * characters. That catches the stored key, an older one, and the first
 * characters of one (a bag named from a pasted key), not just an exact match.
 */
const KEY_LIKE = /sk-ant-[A-Za-z0-9_-]{4,}/g;

export function containsKeyLike(text: string): boolean {
  return text.replace(KEY_LIKE, '') !== text;
}

export function redactKeyLike(text: string, replacement: string = REDACTED): string {
  return text.replace(KEY_LIKE, replacement);
}
