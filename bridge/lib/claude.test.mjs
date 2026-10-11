import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildRunArgs,
  candidatePaths,
  childEnv,
  claudeAuthStatus,
  compareVersions,
  findClaude,
  parseVersion,
  probeClaude,
  resolveSpawn,
  shimTarget,
} from './claude.mjs';

const FAKE = fileURLToPath(new URL('../test/fake-claude.mjs', import.meta.url));
const scratch = () => mkdtempSync(path.join(tmpdir(), 'cafai-bridge-claude-'));

describe('candidatePaths', () => {
  it('looks on PATH first, then where the Windows installers put it', () => {
    const local = scratch();
    mkdirSync(path.join(local, 'Microsoft', 'WinGet', 'Packages', 'Anthropic.ClaudeCode_Microsoft.Winget.Source_8wekyb3d8bbwe'), { recursive: true });
    const paths = candidatePaths({
      platform: 'win32',
      home: 'C:\\Users\\me',
      env: { Path: 'C:\\Tools;"C:\\Program Files\\x"', USERPROFILE: 'C:\\Users\\me', LOCALAPPDATA: local, APPDATA: 'C:\\Users\\me\\AppData\\Roaming' },
    });
    expect(paths.slice(0, 3)).toEqual(['C:\\Tools\\claude.exe', 'C:\\Tools\\claude.cmd', 'C:\\Tools\\claude.bat']);
    expect(paths).toContain('C:\\Program Files\\x\\claude.exe');
    expect(paths).toContain('C:\\Users\\me\\.local\\bin\\claude.exe');
    expect(paths).toContain(path.win32.join(local, 'Microsoft', 'WinGet', 'Packages', 'Anthropic.ClaudeCode_Microsoft.Winget.Source_8wekyb3d8bbwe', 'claude.exe'));
    expect(paths).toContain('C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd');
  });

  it("finds the Claude desktop app's own Claude Code, never the app itself", () => {
    const roaming = scratch();
    const build = path.join(roaming, 'Claude', 'claude-code', '2.1.295', 'd2e29494ec83');
    mkdirSync(build, { recursive: true });
    const paths = candidatePaths({
      platform: 'win32',
      home: 'C:\\Users\\me',
      env: { Path: 'C:\\Users\\me\\AppData\\Local\\AnthropicClaude', USERPROFILE: 'C:\\Users\\me', APPDATA: roaming, LOCALAPPDATA: scratch() },
    });
    expect(paths).toContain(path.win32.join(build, 'claude.exe'));
    expect(paths.some((file) => file.includes('AnthropicClaude'))).toBe(false);
    const mac = candidatePaths({ platform: 'darwin', home: '/Users/me', env: { PATH: '/Applications/Claude.app/Contents/MacOS' } });
    expect(mac.some((file) => file.includes('Claude.app'))).toBe(false);
  });

  it('covers the Mac and Linux installs a LaunchAgent PATH would miss', () => {
    const paths = candidatePaths({ platform: 'darwin', home: '/Users/me', env: { PATH: '/usr/bin:/bin' } });
    expect(paths[0]).toBe('/usr/bin/claude');
    expect(paths).toEqual(expect.arrayContaining(['/Users/me/.local/bin/claude', '/opt/homebrew/bin/claude', '/usr/local/bin/claude', '/Users/me/.claude/local/claude']));
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe('resolveSpawn', () => {
  it('runs a script with this Node and an executable as is', () => {
    expect(resolveSpawn('C:\\x\\cli.js', { platform: 'win32', execPath: 'node.exe' })).toEqual({ command: 'node.exe', args: ['C:\\x\\cli.js'] });
    expect(resolveSpawn('C:\\x\\claude.exe', { platform: 'win32', execPath: 'node.exe' })).toEqual({ command: 'C:\\x\\claude.exe', args: [] });
  });

  it("resolves an npm shim to the script it wraps, not to its node.exe", () => {
    const dir = scratch();
    const cli = path.join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
    mkdirSync(path.dirname(cli), { recursive: true });
    writeFileSync(cli, '');
    writeFileSync(path.join(dir, 'node.exe'), '');
    const shim = path.join(dir, 'claude.cmd');
    writeFileSync(
      shim,
      '@ECHO off\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n)\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*\r\n',
    );
    expect(shimTarget(shim)).toBe(cli);
    expect(resolveSpawn(shim, { platform: 'win32', execPath: 'node.exe' })).toEqual({ command: 'node.exe', args: [cli] });
    expect(shimTarget(path.join(dir, 'missing.cmd'))).toBeNull();
  });
});

describe('versions', () => {
  it('parses and orders them', () => {
    expect(parseVersion('2.1.251 (Claude Code)')).toBe('2.1.251');
    expect(parseVersion('nope')).toBeNull();
    expect(compareVersions('2.1.251', '2.1.126')).toBeGreaterThan(0);
    expect(compareVersions('2.10.0', '2.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });
});

describe('findClaude', () => {
  it('picks the newest install, whatever PATH puts first', async () => {
    const dir = scratch();
    const old = path.join(dir, 'old', 'claude.exe');
    const fresh = path.join(dir, 'fresh', 'claude.exe');
    for (const file of [old, fresh]) {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, '');
    }
    const versions = { [old]: '2.1.126', [fresh]: '2.1.251' };
    const result = await findClaude({
      platform: 'win32',
      home: dir,
      env: { Path: `${path.dirname(old)};${path.dirname(fresh)}`, USERPROFILE: dir, LOCALAPPDATA: dir, APPDATA: dir },
      versionOf: async (spec) => versions[spec.command] ?? null,
    });
    expect(result.chosen).toMatchObject({ path: fresh, version: '2.1.251', command: fresh, args: [] });
    expect(result.found).toEqual(expect.arrayContaining([{ path: old, version: '2.1.126' }, { path: fresh, version: '2.1.251' }]));
  });

  it('takes an explicit path and asks it its version', async () => {
    const result = await findClaude({ explicit: FAKE, env: { ...process.env, FAKE_CLAUDE_VERSION: '3.4.5' } });
    expect(result.chosen).toMatchObject({ path: FAKE, version: '3.4.5', command: process.execPath, args: [FAKE] });
  });

  it('reports nothing found', async () => {
    const dir = scratch();
    const result = await findClaude({ platform: 'win32', home: dir, env: { Path: dir, USERPROFILE: dir, LOCALAPPDATA: dir, APPDATA: dir, ProgramData: dir } });
    expect(result.chosen).toBeNull();
  });
});

describe('childEnv', () => {
  it("drops a parent session's variables and API keys, keeps the user's own setup", () => {
    const env = childEnv({
      PATH: '/bin',
      CLAUDECODE: '1',
      CLAUDE_CODE_ENTRYPOINT: 'sdk-ts',
      CLAUDE_CODE_SESSION_ID: 'abc',
      CLAUDE_CODE_EFFORT_LEVEL: 'max',
      CLAUDE_PID: '9',
      ANTHROPIC_API_KEY: 'sk-ant-x',
      ANTHROPIC_AUTH_TOKEN: 'tok',
      CLAUDE_CODE_OAUTH_TOKEN: 'oauth',
      CLAUDE_CONFIG_DIR: '/cfg',
    });
    expect(env).toMatchObject({ PATH: '/bin', CLAUDE_CODE_OAUTH_TOKEN: 'oauth', CLAUDE_CONFIG_DIR: '/cfg', DISABLE_AUTOUPDATER: '1', MCP_TOOL_TIMEOUT: '3600000' });
    for (const gone of ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_EFFORT_LEVEL', 'CLAUDE_PID', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']) {
      expect(env).not.toHaveProperty(gone);
    }
    expect(childEnv({ ANTHROPIC_API_KEY: 'k' }, { allowApiKey: true }).ANTHROPIC_API_KEY).toBe('k');
  });
});

describe('buildRunArgs', () => {
  it('turns off everything but the coach and our tools', () => {
    const args = buildRunArgs({ model: 'claude-opus-5-5', effort: 'medium', systemPromptFile: '/w/s.txt', mcpConfigFile: '/w/m.json' });
    expect(args).toEqual(expect.arrayContaining(['-p', '--include-partial-messages', '--no-session-persistence', '--strict-mcp-config', '--disable-slash-commands']));
    expect(args.slice(args.indexOf('--tools'), args.indexOf('--tools') + 2)).toEqual(['--tools', '']);
    expect(args.slice(args.indexOf('--setting-sources'), args.indexOf('--setting-sources') + 2)).toEqual(['--setting-sources', '']);
    expect(args.slice(-4)).toEqual(['--mcp-config', '/w/m.json', '--allowedTools', 'mcp__cafai']);
    expect(args).toContain('medium');
    const plain = buildRunArgs({ model: 'm', effort: 'turbo', systemPromptFile: 's' });
    expect(plain).not.toContain('--effort');
    expect(plain).not.toContain('--mcp-config');
  });
});

describe('asking Claude Code', () => {
  const install = { path: FAKE, version: '9.9.9', command: process.execPath, args: [FAKE] };

  it('reads the sign-in state without the email or organisation', async () => {
    expect(await claudeAuthStatus(install)).toEqual({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'max' });
    expect(await claudeAuthStatus(install, { env: { ...process.env, FAKE_CLAUDE_AUTH: 'out' } })).toEqual({
      loggedIn: false,
      authMethod: 'none',
      subscriptionType: null,
    });
    expect(await claudeAuthStatus(null)).toBeNull();
  });

  it('probes with one tiny turn', async () => {
    const ok = await probeClaude(install, { workDir: scratch() });
    expect(ok).toMatchObject({ ok: true, model: 'claude-haiku-4-5' });
    const failed = await probeClaude(install, { workDir: scratch(), env: { ...process.env, FAKE_CLAUDE_PROBE: 'fail' } });
    expect(failed).toMatchObject({ ok: false, said: 'Claude AI usage limit reached' });
    const hung = await probeClaude(install, { workDir: scratch(), timeoutMs: 1500, env: { ...process.env, FAKE_CLAUDE_PROBE: 'hang' } });
    expect(hung).toMatchObject({ ok: false, error: expect.stringContaining('did not answer within 2 s') });
  });
});
