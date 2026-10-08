// SPDX-License-Identifier: GPL-3.0-only
// Derived from Crema web/src/test/provider.test.ts (https://github.com/yarneo/crema @ 628cd714),
// Copyright (C) 2026 Yarden (yarneo). Modified for CafAI: Vitest; the isReady case re-targeted to "an API key is stored", plus secret store tests.
import { describe, expect, it } from 'vitest';
import { openDB } from 'idb';
import { createSecretStore, isReady, openSecretStore, redactSecret, REDACTED, SECRETS_DB_NAME } from './secrets.ts';
import { API_KEY, uniqueDbName } from './testing/fixtures.ts';

describe('SecretStore', () => {
  it('has no key at first', async () => {
    const secrets = await openSecretStore(uniqueDbName('secrets'));
    expect(await secrets.getApiKey()).toBeNull();
  });

  it('stores the key trimmed', async () => {
    const secrets = await openSecretStore(uniqueDbName('secrets'));
    await secrets.setApiKey(`  ${API_KEY}\n`);
    expect(await secrets.getApiKey()).toBe(API_KEY);
  });

  it('forgets the key', async () => {
    const secrets = await openSecretStore(uniqueDbName('secrets'));
    await secrets.setApiKey(API_KEY);
    await secrets.forgetApiKey();
    expect(await secrets.getApiKey()).toBeNull();
  });

  it('treats saving a blank key as forgetting it', async () => {
    const secrets = await openSecretStore(uniqueDbName('secrets'));
    await secrets.setApiKey(API_KEY);
    await secrets.setApiKey('   ');
    expect(await secrets.getApiKey()).toBeNull();
  });

  it('keeps the key across a reload', async () => {
    const name = uniqueDbName('secrets');
    const first = await openSecretStore(name);
    await first.setApiKey(API_KEY);
    first.close();
    const second = await openSecretStore(name);
    expect(await second.getApiKey()).toBe(API_KEY);
  });

  it('keeps the key in its own database, called cafai-secrets by default', async () => {
    expect(SECRETS_DB_NAME).toBe('cafai-secrets');
    const name = uniqueDbName('secrets');
    const secrets = await openSecretStore(name);
    await secrets.setApiKey(API_KEY);
    const db = await openDB(name);
    expect([...db.objectStoreNames]).toEqual(['secrets']);
    db.close();
  });

  it('never puts the key into an error message', async () => {
    const failing = createSecretStore(() => Promise.reject(new Error(`could not store ${API_KEY}`)));
    const error: unknown = await failing.setApiKey(API_KEY).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ name: 'StorageError' });
    expect(String((error as Error).message)).not.toContain(API_KEY);
    expect(JSON.stringify(error)).not.toContain(API_KEY);
    expect((error as { cause?: unknown }).cause).toBeUndefined();
    await expect(failing.getApiKey()).rejects.toMatchObject({ name: 'StorageError' });
    await expect(failing.forgetApiKey()).rejects.toMatchObject({ name: 'StorageError' });
  });

  it('says what failed on this device, a phone as much as a tablet', async () => {
    const failing = createSecretStore(() => Promise.reject(new Error('blocked')));
    await expect(failing.getApiKey()).rejects.toThrow('Could not read the saved API key on this device. Reload the page and try again.');
    await expect(failing.setApiKey(API_KEY)).rejects.toThrow('Could not save the API key on this device. Try again.');
    await expect(failing.forgetApiKey()).rejects.toThrow('Could not remove the API key from this device. Try again.');
    const full = createSecretStore(() => Promise.reject(new DOMException('The quota has been exceeded.', 'QuotaExceededError')));
    await expect(full.setApiKey(API_KEY)).rejects.toMatchObject({
      kind: 'quota',
      message: 'This device is out of storage space, so the API key was not saved.',
    });
  });
});

describe('isReady', () => {
  // Crema: "the local server has no address by default, so it cannot look
  // configured". CafAI talks to Anthropic only, so ready means a key is stored.
  it('is not ready without a stored API key, and ready once one is stored', async () => {
    const secrets = await openSecretStore(uniqueDbName('secrets'));
    expect(await isReady(secrets)).toBe(false);
    await secrets.setApiKey(API_KEY);
    expect(await isReady(secrets)).toBe(true);
    await secrets.forgetApiKey();
    expect(await isReady(secrets)).toBe(false);
  });
});

describe('redactSecret', () => {
  it('replaces every occurrence of the key', () => {
    const text = `key ${API_KEY} and again ${API_KEY}.`;
    expect(redactSecret(text, API_KEY)).toBe(`key ${REDACTED} and again ${REDACTED}.`);
  });

  it('keeps JSON valid when the key sits inside a JSON string', () => {
    const json = JSON.stringify({ notes: `pasted ${API_KEY} by mistake`, n: 1 });
    const redacted = redactSecret(json, API_KEY);
    expect(redacted).not.toContain(API_KEY);
    expect(JSON.parse(redacted)).toEqual({ notes: `pasted ${REDACTED} by mistake`, n: 1 });
  });

  it('leaves text alone when there is no key, or one too short to be real', () => {
    expect(redactSecret('nothing to hide', null)).toBe('nothing to hide');
    expect(redactSecret('a b c', 'a')).toBe('a b c');
  });
});
