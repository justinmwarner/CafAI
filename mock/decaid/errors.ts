/**
 * Dart exceptions, as the mock needs them to pick Decaid's status codes.
 *
 * Decaid's handlers map ArgumentError and FormatException to 400 and let a
 * TypeError (a missing step field) or a plain Exception fall through to 500
 * on create; the message is the Dart `toString()`.
 */
export type DartErrorKind = 'ArgumentError' | 'FormatException' | 'TypeError' | 'Exception';

export class DartError extends Error {
  readonly kind: DartErrorKind;

  constructor(kind: DartErrorKind, message: string) {
    super(message);
    this.name = kind;
    this.kind = kind;
  }
}

/** A response the mock must send exactly as Decaid would (status and body). */
export class MockHttpError extends Error {
  readonly status: number;
  /** JSON body, or null when the body is plain text. */
  readonly body: Record<string, unknown> | null;
  /** shelf's plain-text body (e.g. "Internal Server Error"), when there is no JSON. */
  readonly plainText: string | null;
  readonly headers: Record<string, string>;

  constructor(
    status: number,
    body: Record<string, unknown> | null,
    options: { plainText?: string; headers?: Record<string, string> } = {},
  ) {
    super(typeof body?.error === 'string' ? body.error : (options.plainText ?? `HTTP ${status}`));
    this.name = 'MockHttpError';
    this.status = status;
    this.body = body;
    this.plainText = options.plainText ?? null;
    this.headers = options.headers ?? {};
  }
}

export function argumentError(message: string): DartError {
  return new DartError('ArgumentError', `Invalid argument(s): ${message}`);
}

/** What `Enum.values.byName(value)` throws. */
export function enumNameError(value: string): DartError {
  return new DartError('ArgumentError', `Invalid argument (name): No enum value with that name: "${value}"`);
}

export function formatException(message: string): DartError {
  return new DartError('FormatException', `FormatException: ${message}`);
}

export function typeError(value: unknown, expected: string): DartError {
  return new DartError('TypeError', `type '${dartTypeName(value)}' is not a subtype of type '${expected}'`);
}

export function plainException(message: string): DartError {
  return new DartError('Exception', `Exception: ${message}`);
}

export function dartTypeName(value: unknown): string {
  if (value === null || value === undefined) return 'Null';
  if (typeof value === 'string') return 'String';
  if (typeof value === 'boolean') return 'bool';
  if (typeof value === 'number') return Number.isInteger(value) ? 'int' : 'double';
  if (Array.isArray(value)) return 'List<dynamic>';
  return '_Map<String, dynamic>';
}
