import { describe, expect, it } from 'vitest';
import { isRemembered, parseRoute, placeOf, routeHref, sameRoute, type Route } from './router.ts';
import { SETTINGS_GROUP_IDS } from './settings/groupIds.ts';

describe('parseRoute', () => {
  it('treats an empty or bare hash as the coach', () => {
    for (const hash of ['', '#', '#/', '/', '#/coach', '#/coach/']) {
      expect(parseRoute(hash)).toEqual({ name: 'coach' });
    }
  });

  it('reads the history list and a bag', () => {
    expect(parseRoute('#/history')).toEqual({ name: 'history' });
    expect(parseRoute('#/history/')).toEqual({ name: 'history' });
    expect(parseRoute('#/history/bag_1234')).toEqual({ name: 'history', bagId: 'bag_1234' });
  });

  it('decodes the bag id', () => {
    expect(parseRoute('#/history/a%20b%2Fc')).toEqual({ name: 'history', bagId: 'a b/c' });
  });

  it('falls back to the history list on a malformed bag id', () => {
    expect(parseRoute('#/history/%E0%A4%A')).toEqual({ name: 'history' });
  });

  it('reads settings', () => {
    expect(parseRoute('#/settings')).toEqual({ name: 'settings' });
    expect(parseRoute('#/settings/')).toEqual({ name: 'settings' });
  });

  it("reads Settings' groups (D233), and a group it does not know as the list", () => {
    for (const group of SETTINGS_GROUP_IDS) expect(parseRoute(`#/settings/${group}`)).toEqual({ name: 'settings', group });
    expect(parseRoute('#/Settings/Coach/')).toEqual({ name: 'settings', group: 'coach' });
    expect(parseRoute('#/settings/data?_=1')).toEqual({ name: 'settings', group: 'data' });
    expect(parseRoute('#/settings/extra')).toEqual({ name: 'settings' });
    // Anything deeper is not Settings.
    expect(parseRoute('#/settings/coach/extra')).toEqual({ name: 'coach' });
  });

  it('reads the shot route', () => {
    expect(parseRoute('#/shot')).toEqual({ name: 'shot' });
    expect(parseRoute('#/SHOT/')).toEqual({ name: 'shot' });
    expect(routeHref({ name: 'shot' })).toBe('#/shot');
    expect(sameRoute({ name: 'shot' }, { name: 'shot' })).toBe(true);
  });

  it("reads a drink's view", () => {
    expect(parseRoute('#/steam')).toEqual({ name: 'drink', drink: 'steam' });
    expect(parseRoute('#/hot-water')).toEqual({ name: 'drink', drink: 'hotWater' });
    expect(parseRoute('#/Flush/')).toEqual({ name: 'drink', drink: 'flush' });
    expect(parseRoute('#/hotWater')).toEqual({ name: 'coach' });
    expect(parseRoute('#/steam/extra')).toEqual({ name: 'coach' });
  });

  it('reads the cleaning guide and its routine', () => {
    expect(parseRoute('#/care')).toEqual({ name: 'care', routine: 'daily' });
    expect(parseRoute('#/care/')).toEqual({ name: 'care', routine: 'daily' });
    expect(parseRoute('#/care/weekly')).toEqual({ name: 'care', routine: 'weekly' });
    expect(parseRoute('#/Care/Monthly')).toEqual({ name: 'care', routine: 'monthly' });
    expect(parseRoute('#/care/as-needed')).toEqual({ name: 'care', routine: 'asNeeded' });
    expect(parseRoute('#/care/weekly?_=1')).toEqual({ name: 'care', routine: 'weekly' });
    // An unknown routine is Daily; anything deeper is not the guide.
    expect(parseRoute('#/care/asNeeded')).toEqual({ name: 'care', routine: 'daily' });
    expect(parseRoute('#/care/yearly')).toEqual({ name: 'care', routine: 'daily' });
    expect(parseRoute('#/care/weekly/extra')).toEqual({ name: 'coach' });
  });

  it("tolerates Decaid's ?_=<ms> cache buster", () => {
    expect(parseRoute('#/?_=1759480000000')).toEqual({ name: 'coach' });
    expect(parseRoute('#/settings?_=1759480000000')).toEqual({ name: 'settings' });
    expect(parseRoute('#/history/bag_1?_=1')).toEqual({ name: 'history', bagId: 'bag_1' });
  });

  it('is forgiving about the leading slash and case of the screen name', () => {
    expect(parseRoute('#history')).toEqual({ name: 'history' });
    expect(parseRoute('#/Settings')).toEqual({ name: 'settings' });
    expect(parseRoute('#/HISTORY/Bag_A')).toEqual({ name: 'history', bagId: 'Bag_A' });
  });

  it('sends anything unknown to the coach', () => {
    for (const hash of ['#/nope', '#/history/a/b', '#/settings/a/b', '#/%%%', '#//']) {
      expect(parseRoute(hash)).toEqual({ name: 'coach' });
    }
  });
});

describe('routeHref', () => {
  it('builds hash links', () => {
    expect(routeHref({ name: 'coach' })).toBe('#/');
    expect(routeHref({ name: 'history' })).toBe('#/history');
    expect(routeHref({ name: 'history', bagId: 'bag 1/2' })).toBe('#/history/bag%201%2F2');
    expect(routeHref({ name: 'settings' })).toBe('#/settings');
    expect(routeHref({ name: 'settings', group: 'data' })).toBe('#/settings/data');
  });

  it("builds a drink's link", () => {
    expect(routeHref({ name: 'drink', drink: 'hotWater' })).toBe('#/hot-water');
  });

  it("builds the cleaning guide's links", () => {
    expect(routeHref({ name: 'care', routine: 'daily' })).toBe('#/care');
    expect(routeHref({ name: 'care', routine: 'weekly' })).toBe('#/care/weekly');
    expect(routeHref({ name: 'care', routine: 'monthly' })).toBe('#/care/monthly');
    expect(routeHref({ name: 'care', routine: 'asNeeded' })).toBe('#/care/as-needed');
  });

  it('round-trips through parseRoute', () => {
    const routes: Route[] = [
      { name: 'coach' },
      { name: 'history' },
      { name: 'history', bagId: 'bag_9f2c' },
      { name: 'history', bagId: 'odd id/with?chars#' },
      { name: 'settings' },
      ...SETTINGS_GROUP_IDS.map((group): Route => ({ name: 'settings', group })),
      { name: 'drink', drink: 'steam' },
      { name: 'drink', drink: 'hotWater' },
      { name: 'drink', drink: 'flush' },
      { name: 'care', routine: 'daily' },
      { name: 'care', routine: 'weekly' },
      { name: 'care', routine: 'monthly' },
      { name: 'care', routine: 'asNeeded' },
    ];
    for (const route of routes) expect(parseRoute(routeHref(route))).toEqual(route);
  });
});

describe('sameRoute', () => {
  it('compares by screen and bag', () => {
    expect(sameRoute({ name: 'coach' }, { name: 'coach' })).toBe(true);
    expect(sameRoute({ name: 'history' }, { name: 'history', bagId: 'a' })).toBe(false);
    expect(sameRoute({ name: 'history', bagId: 'a' }, { name: 'history', bagId: 'a' })).toBe(true);
    expect(sameRoute({ name: 'settings' }, { name: 'coach' })).toBe(false);
  });

  it('compares drinks by drink', () => {
    expect(sameRoute({ name: 'drink', drink: 'steam' }, { name: 'drink', drink: 'steam' })).toBe(true);
    expect(sameRoute({ name: 'drink', drink: 'steam' }, { name: 'drink', drink: 'flush' })).toBe(false);
    expect(sameRoute({ name: 'drink', drink: 'steam' }, { name: 'shot' })).toBe(false);
  });

  it("compares Settings by group, the list being a place of its own", () => {
    expect(sameRoute({ name: 'settings', group: 'coach' }, { name: 'settings', group: 'coach' })).toBe(true);
    expect(sameRoute({ name: 'settings', group: 'coach' }, { name: 'settings', group: 'data' })).toBe(false);
    expect(sameRoute({ name: 'settings' }, { name: 'settings', group: 'coach' })).toBe(false);
    expect(sameRoute({ name: 'settings' }, { name: 'settings' })).toBe(true);
  });

  it('compares the guide by routine', () => {
    expect(sameRoute({ name: 'care', routine: 'daily' }, { name: 'care', routine: 'daily' })).toBe(true);
    expect(sameRoute({ name: 'care', routine: 'daily' }, { name: 'care', routine: 'weekly' })).toBe(false);
    expect(sameRoute({ name: 'care', routine: 'daily' }, { name: 'settings' })).toBe(false);
  });
});

describe('isRemembered', () => {
  it("remembers every place but a drink's view", () => {
    expect(isRemembered({ name: 'coach' })).toBe(true);
    expect(isRemembered({ name: 'shot' })).toBe(true);
    expect(isRemembered({ name: 'history', bagId: 'b' })).toBe(true);
    expect(isRemembered({ name: 'settings' })).toBe(true);
    expect(isRemembered({ name: 'drink', drink: 'steam' })).toBe(false);
    expect(isRemembered({ name: 'care', routine: 'monthly' })).toBe(true);
  });
});

describe('placeOf', () => {
  it("puts the guide under Settings, and a drink's view nowhere", () => {
    expect(placeOf({ name: 'care', routine: 'weekly' })).toBe('settings');
    expect(placeOf({ name: 'drink', drink: 'steam' })).toBeNull();
    expect(placeOf({ name: 'history', bagId: 'b' })).toBe('history');
    expect(placeOf({ name: 'settings' })).toBe('settings');
    expect(placeOf({ name: 'shot' })).toBe('shot');
    expect(placeOf({ name: 'coach' })).toBe('coach');
  });
});
