import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CODE_ALPHABET, configDir, formatCode, generateCode, loadConfig, normalizeCode, paths, saveConfig } from './config.mjs';

const CODE = new RegExp(`^[${CODE_ALPHABET}]{8}$`);

describe('configDir', () => {
  it('uses %APPDATA% on Windows, or AppData\\Roaming under the home folder', () => {
    expect(configDir({ platform: 'win32', env: { APPDATA: 'C:\\Users\\me\\AppData\\Roaming' }, home: 'C:\\Users\\me' })).toBe(
      'C:\\Users\\me\\AppData\\Roaming\\CafAI Bridge',
    );
    expect(configDir({ platform: 'win32', env: {}, home: 'C:\\Users\\me' })).toBe('C:\\Users\\me\\AppData\\Roaming\\CafAI Bridge');
  });

  it('uses Application Support on macOS', () => {
    expect(configDir({ platform: 'darwin', env: {}, home: '/Users/me' })).toBe('/Users/me/Library/Application Support/CafAI Bridge');
  });

  it('uses XDG_CONFIG_HOME on Linux when it is absolute, else ~/.config', () => {
    expect(configDir({ platform: 'linux', env: { XDG_CONFIG_HOME: '/xdg' }, home: '/home/me' })).toBe('/xdg/cafai-bridge');
    expect(configDir({ platform: 'linux', env: { XDG_CONFIG_HOME: 'relative' }, home: '/home/me' })).toBe('/home/me/.config/cafai-bridge');
    expect(configDir({ platform: 'linux', env: {}, home: '/home/me' })).toBe('/home/me/.config/cafai-bridge');
  });

  it('takes --config-dir over everything, as an absolute path', () => {
    expect(configDir({ explicit: 'some/dir', platform: 'win32', env: { APPDATA: 'C:\\x' } })).toBe(path.resolve('some/dir'));
  });
});

describe('the pairing code', () => {
  it('is 8 characters from the unambiguous alphabet, and new every time', () => {
    const codes = Array.from({ length: 50 }, () => generateCode());
    for (const code of codes) expect(code).toMatch(CODE);
    expect(new Set(codes).size).toBeGreaterThan(45);
  });

  it('is shown as ABCD-EFGH', () => {
    expect(formatCode('K7QM2XWD')).toBe('K7QM-2XWD');
    expect(formatCode('k7qm 2xwd')).toBe('K7QM-2XWD');
    expect(formatCode('')).toBe('');
  });

  it('is compared upper-cased, letters and digits only', () => {
    expect(normalizeCode(' k7qm-2xwd ')).toBe('K7QM2XWD');
    expect(normalizeCode('K7QM_2X.WD')).toBe('K7QM2XWD');
    expect(normalizeCode(null)).toBe('');
    expect(normalizeCode(undefined)).toBe('');
  });
});

describe('loadConfig', () => {
  let dir;
  beforeEach(() => {
    dir = path.join(mkdtempSync(path.join(os.tmpdir(), 'cafai-bridge-config-')), 'CafAI Bridge');
  });
  afterEach(() => {
    rmSync(path.dirname(dir), { recursive: true, force: true });
  });

  it('names the files inside the folder', () => {
    expect(paths(dir)).toEqual({
      dir: path.resolve(dir),
      configFile: path.join(path.resolve(dir), 'config.json'),
      workDir: path.join(path.resolve(dir), 'work'),
      logFile: path.join(path.resolve(dir), 'bridge.log'),
      pidFile: path.join(path.resolve(dir), 'bridge.pid'),
    });
  });

  it('creates the folder, the work folder and a config with a new code, then keeps it', () => {
    const first = loadConfig(dir);
    expect(first.code).toMatch(CODE);
    expect(existsSync(paths(dir).workDir)).toBe(true);
    expect(JSON.parse(readFileSync(paths(dir).configFile, 'utf8'))).toEqual({ code: first.code });
    expect(loadConfig(dir).code).toBe(first.code);
  });

  it('starts over when config.json is not JSON', () => {
    loadConfig(dir);
    writeFileSync(paths(dir).configFile, '{ broken');
    const config = loadConfig(dir);
    expect(config.code).toMatch(CODE);
    expect(JSON.parse(readFileSync(paths(dir).configFile, 'utf8')).code).toBe(config.code);
  });

  it('adds a code to a config without a usable one, keeping its other keys', () => {
    loadConfig(dir);
    writeFileSync(paths(dir).configFile, JSON.stringify({ note: 'mine', code: 'ABC' }));
    const config = loadConfig(dir);
    expect(config.note).toBe('mine');
    expect(config.code).toMatch(CODE);
    expect(JSON.parse(readFileSync(paths(dir).configFile, 'utf8'))).toEqual({ note: 'mine', code: config.code });
  });

  it('reads a code typed in by hand in any case and with a dash', () => {
    loadConfig(dir);
    writeFileSync(paths(dir).configFile, JSON.stringify({ code: 'k7qm-2xwd' }));
    expect(loadConfig(dir).code).toBe('K7QM2XWD');
  });

  it('saves a changed config', () => {
    const config = loadConfig(dir);
    saveConfig(dir, { ...config, code: 'WXYZ2345' });
    expect(loadConfig(dir).code).toBe('WXYZ2345');
  });

  it.skipIf(process.platform === 'win32')('keeps config.json readable by this user only', () => {
    loadConfig(dir);
    expect(statSync(paths(dir).configFile).mode & 0o777).toBe(0o600);
    chmodSync(paths(dir).configFile, 0o644);
    saveConfig(dir, { code: 'WXYZ2345' });
    expect(statSync(paths(dir).configFile).mode & 0o777).toBe(0o600);
  });
});
