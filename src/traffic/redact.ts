/**
 * What never enters the traffic log (D139). The recorder (recorder.ts) puts
 * everything it keeps through here, whoever recorded it, so no call site can
 * forget:
 *
 *   - a header that carries a secret (x-api-key, authorization, a cookie,
 *     anything named for a key, token, secret, password or session) keeps
 *     its name, so the log still shows it went, but never its value; and
 *     that value is taken out of everything else in the same exchange too,
 *     in any case and with any dashes (hideSecret), so a server that echoes
 *     the key or CafAI Bridge's pairing code back shows a marker;
 *   - anything shaped like an Anthropic API key (sk-ant-…), anywhere: a
 *     body, a URL, a status;
 *   - the body of any call to the key's own namespace in Decaid's store
 *     (D99), whatever the key looks like;
 *   - image data (the bag photo) and other long base64 runs, kept as their
 *     size: "[image, 412 KB]".
 */
import { hideSecret } from '../llm/errors.ts';
import { KEY_NAMESPACE } from '../storage/keyBackup.ts';
import { redactKeyLike } from '../storage/redact.ts';

/** What stands where a key, a pairing code or a secret header's value was. */
export const KEY_MARKER = '[key redacted]';
/** What stands for any body of a call to the key's copy in Decaid (D99). */
export const KEY_COPY_MARKER = "[not kept: the API key's copy in Decaid]";

/** Header names whose values are secrets: x-api-key, authorization, cookie, set-cookie, x-auth-token... */
const SECRET_HEADER = /key|token|secret|password|auth|cookie|session/i;

/** A secret shorter than this is not looked for in the rest of the exchange: it would match ordinary text. */
const MIN_SECRET_CHARS = 6;

/** The key's copy in Decaid's store (src/storage/keyBackup.ts): its body is the key, so it is never kept. */
const KEY_STORE_PATH = new RegExp(`/api/v1/store/${KEY_NAMESPACE}(?:[/?]|$|\\s)`);

/** A JSON string that is nothing but base64, at least this long: image data, a signature, an opaque blob. */
const BASE64_STRING = /"([A-Za-z0-9+/]{1000,}={0,2})"/g;
const DATA_URL = /data:([a-z]+\/[A-Za-z0-9.+-]+);base64,([A-Za-z0-9+/]*={0,2})/g;
/** How base64 image data starts: JPEG, PNG, GIF, WebP. */
const IMAGE_MAGIC = ['/9j/', 'iVBORw0KGgo', 'R0lGOD', 'UklGR'];

export type HeaderSource = Record<string, string> | Headers | null | undefined;

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
  return Object.entries(headers as Record<string, string>);
}

export function redactHeaders(headers: HeaderSource): RedactedHeaders {
  const secrets: string[] = [];
  const lines = entriesOf(headers).map(([name, value]) => {
    const lower = name.toLowerCase();
    if (!SECRET_HEADER.test(lower)) return `${lower}: ${value}`;
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

/**
 * Text as the log may keep it: no image data, nothing shaped like a key, and
 * none of `secrets` (the values of the exchange's secret headers).
 */
export function redactText(text: string, secrets: readonly string[] = []): string {
  if (text === '') return text;
  let out = replaceBase64(text);
  out = redactKeyLike(out, KEY_MARKER);
  for (const secret of secrets) {
    if (secret.length >= MIN_SECRET_CHARS) out = hideSecret(out, secret, KEY_MARKER);
  }
  return out;
}

/** Whether a call ("POST /api/v1/store/cafai-key/anthropic") is to the key's copy in Decaid. */
export function isKeyStoreCall(what: string): boolean {
  return KEY_STORE_PATH.test(what);
}
