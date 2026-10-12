import { describe, expect, it } from 'vitest';
import { decodedSize, isKeyStoreCall, KEY_MARKER, redactHeaders, redactText, replaceBase64 } from './redact.ts';

/** A made-up key, built at run time so no key-shaped literal sits in the source. */
const KEY = ['sk', 'ant', 'api03', 'TrAfFiCLoGtEsT0123456789', 'AbCdEfGhIjKlMnOpQrStUvWxYz_0123456789AA'].join('-');
const CODE = 'K7QM2XWP';

describe('redactHeaders', () => {
  it('keeps a secret header by name only and hands its value back to look for', () => {
    const { text, secrets } = redactHeaders({
      'content-type': 'application/json',
      'x-api-key': KEY,
      Authorization: `Bearer ${KEY}`,
      Cookie: 'session=abcdef123456',
      'anthropic-version': '2023-06-01',
    });
    expect(text).toBe(
      ['content-type: application/json', `x-api-key: ${KEY_MARKER}`, `authorization: ${KEY_MARKER}`, `cookie: ${KEY_MARKER}`, 'anthropic-version: 2023-06-01'].join('\n'),
    );
    expect(text).not.toContain(KEY);
    expect(secrets).toEqual([KEY, `Bearer ${KEY}`, KEY, 'session=abcdef123456']);
  });

  it('reads a Headers object (a reply) the same way', () => {
    const headers = new Headers({ 'Content-Type': 'text/event-stream', 'X-Auth-Token': 'tok-1234567' });
    const { text } = redactHeaders(headers);
    expect(text).toContain('content-type: text/event-stream');
    expect(text).toContain(`x-auth-token: ${KEY_MARKER}`);
    expect(text).not.toContain('tok-1234567');
  });

  it('is empty for no headers', () => {
    expect(redactHeaders(undefined)).toEqual({ text: '', secrets: [] });
  });
});

describe('redactText', () => {
  it('takes out anything shaped like an Anthropic key, in a body or a URL', () => {
    expect(redactText(`{"note":"my key is ${KEY}"}`)).toBe(`{"note":"my key is ${KEY_MARKER}"}`);
    expect(redactText(`GET /api/v1/x?key=${KEY}&a=1`)).toBe(`GET /api/v1/x?key=${KEY_MARKER}&a=1`);
  });

  it("takes out a header's secret in any case and through dashes (the bridge's code as ABCD-EFGH)", () => {
    const echoed = `{"error":{"message":"Wrong code K7QM-2XWP (you sent k7qm2xwp)"}}`;
    const out = redactText(echoed, [CODE]);
    expect(out).toBe(`{"error":{"message":"Wrong code ${KEY_MARKER} (you sent ${KEY_MARKER})"}}`);
  });

  it('does not look for a secret too short to tell from ordinary text', () => {
    expect(redactText('the 123 of it', ['123'])).toBe('the 123 of it');
  });

  it('leaves ordinary text alone', () => {
    const text = '{"profile":{"title":"Kiambu AA v2"},"targetWeight":36}';
    expect(redactText(text)).toBe(text);
  });
});

describe('replaceBase64', () => {
  const jpeg = `/9j/${'A'.repeat(4000)}`;

  it('keeps the bag photo in a coach request as its size', () => {
    const body = JSON.stringify({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpeg } });
    const out = replaceBase64(body);
    expect(out).toBe(JSON.stringify({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: `[image, ${decodedSize(jpeg.length)}]` } }));
    expect(out).toContain('[image, 3 KB]');
    expect(JSON.parse(out)).toBeTruthy();
  });

  it('keeps a data URL as its size', () => {
    expect(replaceBase64(`<img src="data:image/png;base64,${'Q'.repeat(2048)}">`)).toBe('<img src="[image, 2 KB]">');
  });

  it('names other long base64 data as data, and leaves short strings alone', () => {
    const blob = 'Zm9v'.repeat(400);
    expect(replaceBase64(`{"signature":"${blob}","id":"abc"}`)).toBe('{"signature":"[base64 data, 1 KB]","id":"abc"}');
    expect(replaceBase64('{"id":"Zm9vYmFy"}')).toBe('{"id":"Zm9vYmFy"}');
  });

  it('runs inside redactText', () => {
    expect(redactText(`"${jpeg}"`)).toBe('"[image, 3 KB]"');
  });
});

describe('isKeyStoreCall', () => {
  it("knows the key's copy in Decaid's store (D99), and nothing else", () => {
    expect(isKeyStoreCall('POST /api/v1/store/cafai-key/anthropic')).toBe(true);
    expect(isKeyStoreCall('GET /api/v1/store/cafai-key?full=1')).toBe(true);
    expect(isKeyStoreCall('GET /api/v1/store/cafai-key')).toBe(true);
    expect(isKeyStoreCall('POST /api/v1/store/cafai/settings')).toBe(false);
    expect(isKeyStoreCall('GET /api/v1/store/cafai-keyring/x')).toBe(false);
  });
});
