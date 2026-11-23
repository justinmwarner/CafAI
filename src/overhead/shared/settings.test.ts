import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, inNightWindow, readSettings, SETTING_SPECS, settingsValues, validValues } from './settings.ts';

describe('the plugin’s settings', () => {
  it('has the brief’s defaults, and no home', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({
      screensaverOn: true,
      idleMinutes: 3,
      homeLat: null,
      homeLon: null,
      radiusNm: 25,
      listCeilingFt: 10000,
      pollIntervalSeconds: 5,
      notableRadiusNm: 25,
      nowCpaMiles: 0.5,
      nowWindowSeconds: 30,
      soonCpaMiles: 1.5,
      soonWithinMinutes: 10,
      passedForSeconds: 60,
      nightDimStart: null,
      nightDimEnd: null,
      mapTilerKey: null,
      mockMode: false,
    });
  });

  it('applies the defaults Decaid leaves out (onLoad gets only saved values)', () => {
    expect(readSettings({})).toEqual(DEFAULT_SETTINGS);
    expect(readSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(readSettings({ RadiusNm: 30 }).radiusNm).toBe(30);
  });

  it('never polls faster than every 2 s', () => {
    expect(readSettings({ PollIntervalSeconds: 0.5 }).pollIntervalSeconds).toBe(2);
    expect(readSettings({ PollIntervalSeconds: 2 }).pollIntervalSeconds).toBe(2);
  });

  it('counts home only with both halves, in range', () => {
    expect(readSettings({ HomeLat: 41.9 }).homeLat).toBeNull();
    expect(readSettings({ HomeLat: 41.9, HomeLon: -87.9 })).toMatchObject({ homeLat: 41.9, homeLon: -87.9 });
    expect(readSettings({ HomeLat: 95, HomeLon: -87.9 }).homeLat).toBeNull();
    expect(readSettings({ HomeLat: '41.9', HomeLon: '-87.9' })).toMatchObject({ homeLat: 41.9, homeLon: -87.9 });
  });

  it('reads text settings by their shape', () => {
    expect(readSettings({ HomeAirport: ' kmdw ' }).homeAirport).toBe('KMDW');
    expect(readSettings({ HomeAirport: 'O Hare' }).homeAirport).toBe('KORD');
    expect(readSettings({ NightDimStart: '22:30', NightDimEnd: '6:00' })).toMatchObject({ nightDimStart: '22:30', nightDimEnd: null });
    expect(readSettings({ MockMode: 'true' }).mockMode).toBe(true);
  });

  it('keeps only valid values from a config post, and an explicit null to clear one', () => {
    expect(validValues({ HomeLat: 41.98, RadiusNm: 'far', Unknown: 1, MapTilerKey: null, PollIntervalSeconds: 1 })).toEqual({ HomeLat: 41.98, MapTilerKey: null, PollIntervalSeconds: 2 });
  });

  it('answers every setting by its manifest key', () => {
    const values = settingsValues(DEFAULT_SETTINGS);
    expect(Object.keys(values)).toEqual(SETTING_SPECS.map((spec) => spec.key));
    expect(readSettings(values)).toEqual(DEFAULT_SETTINGS);
  });

  it('gives every setting a label and a description, as Decaid asks', () => {
    for (const spec of SETTING_SPECS) {
      expect(spec.label.length).toBeGreaterThan(2);
      expect(spec.description.length).toBeGreaterThan(10);
      expect(spec.key).toMatch(/^[A-Z][A-Za-z]+$/);
    }
  });
});

describe('the night window', () => {
  const at = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
  it('may cross midnight', () => {
    expect(inNightWindow('22:00', '06:30', at('23:15'))).toBe(true);
    expect(inNightWindow('22:00', '06:30', at('03:00'))).toBe(true);
    expect(inNightWindow('22:00', '06:30', at('06:30'))).toBe(false);
    expect(inNightWindow('22:00', '06:30', at('12:00'))).toBe(false);
  });
  it('may not', () => {
    expect(inNightWindow('01:00', '05:00', at('02:00'))).toBe(true);
    expect(inNightWindow('01:00', '05:00', at('05:00'))).toBe(false);
  });
  it('is never on without both ends, or with equal ends', () => {
    expect(inNightWindow(null, '06:00', at('03:00'))).toBe(false);
    expect(inNightWindow('06:00', '06:00', at('06:00'))).toBe(false);
  });
});
