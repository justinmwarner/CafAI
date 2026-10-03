import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256Hex, utf8Bytes } from './sha256.ts';

const nodeHex = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

describe('sha256Hex', () => {
  it('matches the FIPS 180-2 test vectors', () => {
    expect(sha256Hex(utf8Bytes(''))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex(utf8Bytes('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex(utf8Bytes('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('handles a million bytes (many blocks)', () => {
    expect(sha256Hex(utf8Bytes('a'.repeat(1_000_000)))).toBe(
      'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
    );
  });

  it('agrees with node:crypto around every padding boundary', () => {
    // 55, 56 and 64 bytes are where the length field stops fitting in the block.
    for (let n = 0; n <= 130; n++) {
      const text = 'x'.repeat(n);
      expect(sha256Hex(utf8Bytes(text)), `length ${n}`).toBe(nodeHex(text));
    }
  });

  it('hashes non-ASCII text as UTF-8, like Dart utf8.encode', () => {
    for (const text of ['°C', 'Café crème', 'D-Flow / default', '咖啡', 'emoji ☕ 🫘']) {
      expect(sha256Hex(utf8Bytes(text))).toBe(nodeHex(text));
    }
  });
});
