// Where CafAI Bridge keeps its files, and the pairing code CafAI sends as its key.
//
// One folder per user, where each OS expects it: Windows %APPDATA%, macOS
// ~/Library/Application Support, Linux $XDG_CONFIG_HOME. It holds config.json
// (the code), the log, the pid file of a running bridge and `work`, the empty
// folder Claude Code runs in. On macOS and Linux only this user can read the
// config, as the code is all that keeps other devices on the network out.
import { randomInt } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Letters and digits nobody confuses when reading them off a screen: no 0/O or 1/I. */
export const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
/** 8 characters of 32: 40 bits, against five guesses per ten minutes per address. */
export const CODE_LENGTH = 8;

const APP_FOLDER = 'CafAI Bridge';

/**
 * The bridge's folder for this user. `explicit` (`--config-dir`) wins.
 * @param {{ explicit?: string | null, platform?: string, env?: Record<string, string | undefined>, home?: string }} [options]
 * @returns {string}
 */
export function configDir({ explicit = null, platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  if (explicit) return path.resolve(explicit);
  if (platform === 'win32') {
    return path.win32.join(env.APPDATA || path.win32.join(home, 'AppData', 'Roaming'), APP_FOLDER);
  }
  if (platform === 'darwin') return path.posix.join(home, 'Library', 'Application Support', APP_FOLDER);
  // The XDG spec says a relative XDG_CONFIG_HOME is invalid and must be ignored.
  const xdg = env.XDG_CONFIG_HOME;
  return path.posix.join(xdg && path.posix.isAbsolute(xdg) ? xdg : path.posix.join(home, '.config'), 'cafai-bridge');
}

/**
 * The bridge's files inside its folder, as absolute paths.
 * @param {string} dir
 * @returns {{ dir: string, configFile: string, workDir: string, logFile: string, pidFile: string }}
 */
export function paths(dir) {
  const root = path.resolve(dir);
  return {
    dir: root,
    configFile: path.join(root, 'config.json'),
    workDir: path.join(root, 'work'),
    logFile: path.join(root, 'bridge.log'),
    pidFile: path.join(root, 'bridge.pid'),
  };
}

/** A new pairing code, e.g. "K7QM2XWD". */
export function generateCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

/** The code as people read and type it: "K7QM-2XWD". */
export function formatCode(code) {
  return (normalizeCode(code).match(/.{1,4}/g) ?? []).join('-');
}

/**
 * The form codes are compared in: upper case, letters and digits only, so
 * "k7qm 2xwd" typed on a tablet matches "K7QM-2XWD".
 * @param {unknown} text
 * @returns {string}
 */
export function normalizeCode(text) {
  return String(text ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/** A code someone wrote into config.json by hand counts if it is at least as long as ours. */
function usableCode(value) {
  return typeof value === 'string' && normalizeCode(value).length >= CODE_LENGTH;
}

/**
 * The bridge's config. Creates the folder and its work folder, and a
 * config.json with a new code when there is none, it is not JSON, or it holds
 * no usable code (other keys in it are kept).
 * @param {string} dir
 * @returns {{ code: string, [key: string]: unknown }}
 */
export function loadConfig(dir) {
  const files = paths(dir);
  mkdirSync(files.dir, { recursive: true, mode: 0o700 });
  mkdirSync(files.workDir, { recursive: true, mode: 0o700 });
  let config = null;
  try {
    const parsed = JSON.parse(readFileSync(files.configFile, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) config = parsed;
  } catch {
    // Missing or broken: a new code below.
  }
  if (config && usableCode(config.code)) return { ...config, code: normalizeCode(config.code) };
  const fresh = { ...(config ?? {}), code: generateCode() };
  saveConfig(dir, fresh);
  return fresh;
}

/**
 * Write the config; on macOS and Linux readable by this user only.
 * @param {string} dir
 * @param {{ code: string, [key: string]: unknown }} config
 */
export function saveConfig(dir, config) {
  const files = paths(dir);
  mkdirSync(files.dir, { recursive: true, mode: 0o700 });
  writeFileSync(files.configFile, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  // `mode` only applies to a new file; an existing one keeps its permissions.
  if (process.platform !== 'win32') chmodSync(files.configFile, 0o600);
}
