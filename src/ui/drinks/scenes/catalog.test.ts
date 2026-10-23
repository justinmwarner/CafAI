import { describe, expect, it } from 'vitest';
import { DRINK_KINDS } from '../kinds.ts';
import { defaultScene, sceneFor, SCENES } from './catalog.ts';
import { createScene, FACTORIES } from './registry.ts';

describe('the scenes each drink offers', () => {
  it('lists the default first and Simple last, by name', () => {
    expect(SCENES.steam.map((s) => s.name)).toEqual(['Wand and spray', 'Whirlpool', 'Rosetta', 'Simple']);
    expect(SCENES.hotWater.map((s) => s.name)).toEqual(['Pour', 'From above', 'Simple']);
    expect(SCENES.flush.map((s) => s.name)).toEqual(['Shower', 'Screen', 'Simple']);
    expect(DRINK_KINDS.map(defaultScene)).toEqual(['spray', 'shower', 'pour']);
  });

  it('keeps ids storage can keep: short lowercase words, unique per drink', () => {
    for (const kind of DRINK_KINDS) {
      const ids = SCENES[kind].map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9-]{0,31}$/);
    }
  });

  it('reads an id the drink does not have as its default', () => {
    expect(sceneFor('steam', 'whirlpool')).toBe('whirlpool');
    expect(sceneFor('steam', 'pour')).toBe('spray');
    expect(sceneFor('hotWater', 'tornado')).toBe('pour');
    expect(sceneFor('flush', undefined)).toBe('shower');
    expect(sceneFor('flush', null)).toBe('shower');
  });

  it('has a scene to make for every choice, and makes the default for any other', () => {
    for (const kind of DRINK_KINDS) {
      expect(Object.keys(FACTORIES[kind]).sort()).toEqual(SCENES[kind].map((s) => s.id).sort());
      for (const { id } of SCENES[kind]) {
        const scene = createScene(kind, id);
        expect(typeof scene.update).toBe('function');
        expect(typeof scene.draw).toBe('function');
        expect(typeof scene.settling).toBe('function');
      }
      expect(createScene(kind, 'nonsense')).toBeDefined();
    }
  });
});
