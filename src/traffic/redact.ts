/**
 * What never enters the traffic log (D139). The recorder (recorder.ts) puts
 * everything it keeps through here, whoever recorded it, so no call site can
 * forget:
 *
 *   - a header that carries a secret (x-api-key, authorization, a cookie, a
 *     name with a key, token, secret, password, auth or session part) keeps
 *     its name, so the log still shows it went, but never its value; and
 *     that value is taken out of everything else in the same exchange too,
 *     headers included, in any case and with any dashes (hideSecret), so a
 *     server that echoes the key or CafAI Bridge's pairing code back shows a
 *     marker;
 *   - the secrets CafAI knows (the key and the pairing code it last used,
 *     recorder.ts's rememberSecret), wherever they show: the chat, a backup;
 *   - anything shaped like an Anthropic API key (sk-ant-…), anywhere: a
 *     body, a URL, a status, a header;
 *   - the body of any call to the key's own namespace in Decaid's store
 *     (D99), whatever the key looks like (one with no room for a key stays:
 *     Decaid's null says it has no copy), and to the namespace of where the
 *     coach runs (D229), whose copy holds CafAI Bridge's code before CafAI
 *     has used it;
 *   - image data (the bag photo) and other long base64 runs, kept as their
 *     size: "[image, 412 KB]".
 */
import { hideSecret } from '../llm/errors.ts';
import { COACH_SOURCE_NAMESPACE } from '../storage/coachSourceBackup.ts';
import { KEY_NAMESPACE } from '../storage/keyBackup.ts';
import { containsKeyLike, redactKeyLike } from '../storage/redact.ts';

/** What stands where a key, a pairing code or a secret header's value was. */
export const KEY_MARKER = '[key redacted]';
/** What stands for any body of a call to the key's copy in Decaid (D99). */
export const KEY_COPY_MARKER = "[not kept: the API key's copy in Decaid]";
/** What stands for any body of a call to where the coach runs, copied in Decaid (D229). */
export const COACH_SOURCE_COPY_MARKER = "[not kept: where the coach runs, copied in Decaid]";

/**
 * Header names whose values are secrets, by a whole part of the name:
 * x-api-key, authorization, proxy-authorization, cookie, set-cookie,
 * x-auth-token. Not anthropic-ratelimit-tokens-remaining: "tokens" there is a
 * count, and its number must not be taken out of the body.
 */
const SECRET_HEADER = /(?:^|-)(?:key|apikey|token|secret|password|passwd|auth|authorization|cookie|session)(?:-|$)/i;

/**
 * A secret shorter than this is not looked for elsewhere: it would match
 * ordinary text. The pairing code has 8 characters, the API key over 100.
 */
const MIN_SECRET_CHARS = 8;

/** The key's copy in Decaid's store (src/storage/keyBackup.ts): its body is the key, so it is never kept. */
const KEY_STORE_PATH = new RegExp(`/api/v1/store/${KEY_NAMESPACE}(?:[/?]|$|\\s)`);
/** Where the coach runs, copied in Decaid's store (src/storage/coachSourceBackup.ts): its body holds the code. */
const COACH_SOURCE_STORE_PATH = new RegExp(`/api/v1/store/${COACH_SOURCE_NAMESPACE}(?:[/?]|$|\\s)`);

/** A JSON string that is nothing but base64, at least this long: image data, a signature, an opaque blob. */
const BASE64_STRING = /"([A-Za-z0-9+/]{1000,}={0,2})"/g;
const DATA_URL = /data:([a-z]+\/[A-Za-z0-9.+-]+);base64,([A-Za-z0-9+/]*={0,2})/g;
/** How base64 image data starts: JPEG, PNG, GIF, WebP. */
const IMAGE_MAGIC = ['/9j/', 'iVBORw0KGgo', 'R0lGOD', 'UklGR'];

/** Headers as a request's object, a reply's Headers, or name-value pairs. */
export type HeaderSource = Record<string, string> | Headers | ReadonlyArray<readonly [string, string]> | null | undefined;

export interface RedactedHeaders {
  /** "name: value" lines, names in lower case, secret values replaced. */
  text: string;
  /** The values taken out, to look for in the rest of the exchange. Never stored. */
  secrets: string[];
}

function entriesOf(headers: HeaderSource): Array<[string, string]> {
  if (!headers) return [];
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    const list: Array<[string, string]> = [];
    headers.forEach((value, name) => list.push([name, value]));
    return list;
  }
  const pairs = Array.isArray(headers) ? (headers as ReadonlyArray<readonly [unknown, unknown]>) : Object.entries(headers as Record<string, unknown>);
  return pairs.map(([name, value]) => [String(name), String(value)]);
}

/** Whether a header's value is a secret, by its name. */
export function isSecretHeader(name: string): boolean {
  return SECRET_HEADER.test(name);
}

export function redactHeaders(headers: HeaderSource): RedactedHeaders {
  const secrets: string[] = [];
  const lines = entriesOf(headers).map(([name, value]) => {
    const lower = name.toLowerCase();
    if (!isSecretHeader(lower)) return `${lower}: ${value}`;
    const whole = value.trim();
    if (whole.length >= MIN_SECRET_CHARS) secrets.push(whole);
    // "Bearer <token>": the token may come back on its own.
    const token = whole.split(/\s+/).pop() ?? '';
    if (token !== whole && token.length >= MIN_SECRET_CHARS) secrets.push(token);
    return `${lower}: ${KEY_MARKER}`;
  });
  return { text: lines.join('\n'), secrets };
}

/** "412 KB" for base64 text of this many characters (what it decodes to). */
export function decodedSize(base64Chars: number): string {
  const bytes = Math.floor((base64Chars * 3) / 4);
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function base64Label(data: string, mediaType: string | null): string {
  const image = mediaType ? mediaType.startsWith('image/') : IMAGE_MAGIC.some((magic) => data.startsWith(magic));
  return `[${image ? 'image' : 'base64 data'}, ${decodedSize(data.length)}]`;
}

/** Image data and other long base64 runs as their size, so a photo never fills the log. */
export function replaceBase64(text: string): string {
  return text
    .replace(DATA_URL, (_match, mediaType: string, data: string) => base64Label(data, mediaType))
    .replace(BASE64_STRING, (_match, data: string) => `"${base64Label(data, null)}"`);
}

/** The secrets worth looking for: long enough not to match ordinary text. */
function usable(secrets: readonly string[]): string[] {
  return secrets.filter((secret) => secret.length >= MIN_SECRET_CHARS);
}

/**
 * Text as the log may keep it: no image data, nothing shaped like a key, and
 * none of `secrets` (the exchange's secret header values and the secrets
 * CafAI knows).
 */
export function redactText(text: string, secrets: readonly string[] = []): string {
  if (text === '') return text;
  let out = replaceBase64(text);
  out = redactKeyLike(out, KEY_MARKER);
  for (const secret of usable(secrets)) out = hideSecret(out, secret, KEY_MARKER);
  return out;
}

/** Whether `text` holds anything redactText would take out as a key or a secret (image data aside). */
export function holdsSecret(text: string, secrets: readonly string[] = []): boolean {
  if (text === '') return false;
  if (containsKeyLike(text)) return true;
  return usable(secrets).some((secret) => hideSecret(text, secret, '\u0000') !== text);
}

/** Whether a call ("POST /api/v1/store/cafai-key/anthropic") is to the key's copy in Decaid. */
export function isKeyStoreCall(what: string): boolean {
  return KEY_STORE_PATH.test(what);
}

/** Bodies with no room for a key: Decaid's null for no copy, its {} for a write, an empty list or string. */
const KEYLESS_BODIES: ReadonlySet<string> = new Set(['', 'null', '{}', '[]', '""']);

/** A body of a call to the key's copy in Decaid as the log keeps it: the marker, unless it cannot hold a key. */
export function keyStoreBody(body: string): string {
  return KEYLESS_BODIES.has(body.trim()) ? body : KEY_COPY_MARKER;
}

/** Whether a call ("POST /api/v1/store/cafai-coach-source/current") is to where the coach runs, copied in Decaid. */
export function isCoachSourceStoreCall(what: string): boolean {
  return COACH_SOURCE_STORE_PATH.test(what);
}

/** A body of a call to that copy as the log keeps it: the marker, unless it cannot hold a code. */
export function coachSourceStoreBody(body: string): string {
  return KEYLESS_BODIES.has(body.trim()) ? body : COACH_SOURCE_COPY_MARKER;
}
