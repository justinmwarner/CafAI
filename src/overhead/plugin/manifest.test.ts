import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SETTING_SPECS } from '../shared/settings.ts';
import { overheadManifest } from './manifest.ts';

/** The permissions Decaid v0.9.2 knows (doc/Plugins.md, "Manifest Fields"): an unknown one makes the manifest invalid. */
const KNOWN_PERMISSIONS = new Set([
  'log',
  'api',
  'emit',
  'notifications',
  'pluginStorage',
  'events.machine',
  'events.shots',
  'events.workflow',
  'proxy.decent_api',
  'proxy.decent_api.write',
  'network.websocket',
  'network.tcp',
  'network.tls',
  'manage.extensions',
]);

/** Decaid's own routes under /api/v1/plugins/:id/, which win over a plugin endpoint of the same name. */
const DECAID_ROUTES = new Set(['settings', 'source', 'enable', 'disable', 'update']);

describe('the plugin’s manifest', () => {
  const version = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')).version as string;
  const manifest = overheadManifest(version);

  it('is a valid Decaid manifest', () => {
    expect(manifest.id).toBe('overhead.reaplugin');
    expect(manifest.id).not.toMatch(/[\\/]|^\.\.?$/);
    expect(manifest.apiVersion).toBe(1);
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    for (const permission of manifest.permissions) expect(KNOWN_PERMISSIONS.has(permission)).toBe(true);
    // No more than it needs: no management, no outbound sockets.
    expect(manifest.permissions).toEqual(['log', 'api', 'emit', 'pluginStorage', 'events.machine']);
  });

  it('declares every setting with Decaid’s types, a label and a description', () => {
    expect(Object.keys(manifest.settings)).toEqual(SETTING_SPECS.map((spec) => spec.key));
    for (const setting of Object.values(manifest.settings)) {
      expect(['string', 'number', 'boolean']).toContain(setting.type);
      expect(setting.label).toBeTruthy();
      expect(setting.description).toBeTruthy();
    }
    expect(manifest.settings.HomeLat).not.toHaveProperty('default');
    expect(manifest.settings.PollIntervalSeconds).toMatchObject({ type: 'number', default: 5 });
  });

  it('names its endpoints so Decaid’s own routes do not hide them', () => {
    const ids = manifest.api.map((entry) => entry.id);
    expect(ids).toEqual(['overhead', 'config', 'notable']);
    for (const id of ids) expect(DECAID_ROUTES.has(id)).toBe(false);
    expect(manifest.api.map((entry) => entry.type)).toEqual(['http', 'http', 'websocket']);
  });
});
