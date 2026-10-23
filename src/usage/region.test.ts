import { describe, expect, it } from 'vitest';
import { consentRule, regionOf } from './region.ts';

const rule = (timeZone: string | undefined, languages: string[] = ['en-US']) => consentRule({ timeZone, languages });

describe('consentRule (D-USAGE-2)', () => {
  it('asks first in every European zone', () => {
    for (const zone of ['Europe/Berlin', 'Europe/London', 'Europe/Zurich', 'Europe/Dublin', 'Europe/Istanbul', 'Europe/Kyiv']) {
      expect(rule(zone), zone).toBe('ask');
    }
  });

  it('asks first in the European zones outside Europe/', () => {
    const zones = [
      'Asia/Nicosia',
      'Asia/Famagusta',
      'Atlantic/Canary',
      'Atlantic/Madeira',
      'Atlantic/Azores',
      'Atlantic/Reykjavik',
      'Atlantic/Faroe',
      'Africa/Ceuta',
      'Arctic/Longyearbyen',
      'America/Cayenne',
      'America/Guadeloupe',
      'America/Martinique',
      'America/Marigot',
      'Indian/Reunion',
      'Indian/Mayotte',
    ];
    for (const zone of zones) expect(rule(zone), zone).toBe('ask');
  });

  it('asks first when the zone says nothing', () => {
    for (const zone of [undefined, '', 'UTC', 'GMT', 'Etc/UTC', 'Etc/GMT+1', 'Universal', 'Zulu']) expect(rule(zone), String(zone)).toBe('ask');
  });

  it('asks first when a language names a European country', () => {
    for (const tag of ['de-DE', 'en-GB', 'fr-CH', 'nb-NO', 'is-IS', 'de-LI', 'en-IE', 'pt-PT', 'el-GR', 'en-150']) {
      expect(rule('America/Chicago', ['en-US', tag]), tag).toBe('ask');
    }
  });

  it('is the notice elsewhere', () => {
    for (const zone of ['America/Chicago', 'America/New_York', 'Asia/Tokyo', 'Australia/Sydney', 'Asia/Hong_Kong', 'America/Sao_Paulo']) {
      expect(rule(zone), zone).toBe('notice');
    }
    expect(rule('America/Chicago', [])).toBe('notice');
    expect(rule('America/Chicago', ['en', 'es-419', 'zh-Hant-TW', 'sr-Latn-RS'])).toBe('notice');
  });
});

describe('regionOf', () => {
  it("reads a language tag's region", () => {
    expect(regionOf('de-DE')).toBe('DE');
    expect(regionOf('en_gb')).toBe('GB');
    expect(regionOf('zh-Hant-TW')).toBe('TW');
    expect(regionOf('es-419')).toBe('419');
    expect(regionOf('en')).toBeNull();
    expect(regionOf('')).toBeNull();
  });

  it('reads nothing past the extensions', () => {
    expect(regionOf('en-u-rg-gbzzzz')).toBeNull();
    expect(regionOf('de-DE-u-co-phonebk')).toBe('DE');
  });
});
