/**
 * The plugin's manifest.json, built from the settings table so the two never
 * disagree (vite.plugin.config.ts writes it next to plugin.js). Decaid's
 * rules (doc/Plugins.md at v0.9.2): the id is a single safe path component,
 * every permission is one Decaid knows, every setting has a label and a
 * description.
 */
import { CONFIG_ENDPOINT, NOTABLE_EVENT, OVERHEAD_ENDPOINT, OVERHEAD_PLUGIN_ID, SETTING_SPECS } from '../shared/settings.ts';

export const PERMISSIONS = ['log', 'api', 'emit', 'pluginStorage', 'events.machine'] as const;

export function overheadManifest(version: string) {
  return {
    id: OVERHEAD_PLUGIN_ID,
    author: 'CafAI',
    name: 'Overhead',
    description: "Aircraft near your home for CafAI's Overhead screensaver: positions from airplanes.live, adsb.fi or adsb.lol, routes and types from hexdb.io, notable aircraft from plane-alert-db. Free sources, no keys, non-commercial use.",
    version,
    apiVersion: 1,
    permissions: [...PERMISSIONS],
    settings: Object.fromEntries(
      SETTING_SPECS.map((spec) => [
        spec.key,
        {
          type: spec.kind,
          label: spec.label,
          description: spec.description,
          ...(spec.fallback === null ? {} : { default: spec.fallback }),
        },
      ]),
    ),
    api: [
      {
        id: OVERHEAD_ENDPOINT,
        type: 'http',
        data: {
          description: 'GET: the aircraft around home, version 1 (docs/overhead/README.md). ?active=0 reads without counting as the screensaver showing; ?mock=1 replays the recorded fixtures.',
        },
      },
      {
        id: CONFIG_ENDPOINT,
        type: 'http',
        data: {
          description: 'GET: the settings in effect. POST {"values": {...}} keyed as the settings are: saves them over the ones set here (null clears one).',
        },
      },
      {
        id: NOTABLE_EVENT,
        type: 'websocket',
        data: {
          hex: { type: 'string', description: 'ICAO address, lower case' },
          operator: { type: 'string', description: "plane-alert-db's $Operator" },
          category: { type: 'string', description: "plane-alert-db's Category" },
          distanceNm: { type: 'number', description: 'From home as it came within the notable area' },
          description: 'Sent once when a notable aircraft first comes within the notable area.',
        },
      },
    ],
  };
}
