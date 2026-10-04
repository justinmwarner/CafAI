import { describe, expect, it } from 'vitest';
import { containsKeyLike, redactKeyLike } from './redact.ts';
import { redactSecret } from './secrets.ts';

describe('key-shaped text', () => {
  it('finds and removes anything shaped like an Anthropic key, whole or in part', () => {
    const key = 'sk-ant-api03-AbC_dEf-123456789';
    expect(containsKeyLike(`my key is ${key}, thanks`)).toBe(true);
    expect(redactKeyLike(`my key is ${key}, thanks`)).toBe('my key is [redacted], thanks');
    // The first characters of a pasted key, e.g. a bag named from it.
    expect(redactKeyLike('sk-ant-qa-secret-key-12345678 v1')).toBe('[redacted] v1');
    expect(redactKeyLike('A, B: sk-ant-api03-x and sk-ant-api03-y', '[key removed]')).toBe(
      'A, B: [key removed] and [key removed]',
    );
  });

  it('leaves ordinary text alone', () => {
    for (const text of ['Kiambu AA, light roast', 'sk-ant', 'task-ant-1', 'ask-antonio']) {
      expect(containsKeyLike(text)).toBe(false);
      expect(redactKeyLike(text)).toBe(text);
    }
  });

  it('redacts key-shaped text in backups even when it is not the stored key', () => {
    const json = JSON.stringify({ name: 'sk-ant-old-key-1234567890 v1', note: 'stored: sk-ant-current-0987654321' });
    const out = redactSecret(json, 'sk-ant-current-0987654321');
    expect(out).not.toContain('sk-ant-');
    expect(JSON.parse(out)).toEqual({ name: '[redacted] v1', note: 'stored: [redacted]' });
  });
});
