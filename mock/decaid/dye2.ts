/**
 * DYE2's `autoFavourites` KV shape (D7): a "recent" auto-favourite entry, as
 * DYE2's plugin runtime builds it in `.ref/dye2/dye2-plugin/src/utils/
 * recent-favs.ts` (`toRecentFavourite`) and documents in
 * `.ref/dye2/docs/KV_CONTRACT.md` ("Auto (recent) entries"). The mock does
 * not run DYE2's shot-history scan; it seeds two plausible setups for a bean
 * batch instead, in the same shape GET /api/v1/plugins/dye2.reaplugin/
 * recent-favs and the KV key both answer with.
 */
import type { Bean, BeanBatch } from '../../src/api/types.ts';

export interface Dye2RecentFavourite {
  id: string;
  auto: true;
  recentRank: number;
  sourceShotId: string;
  title: string;
  subtitle: string;
  beverage: string;
  alwaysOnDashboard: false;
  favSlot: null;
  copyMask: {
    profile: boolean;
    beans: boolean;
    grinder: boolean;
    grindSetting: boolean;
    dose: boolean;
    drink: boolean;
    roastDate: boolean;
    basket: boolean;
    equipment: boolean;
    barista: boolean;
    drinker: boolean;
    note: boolean;
  };
  snapshot: {
    profileTitle: string;
    beanBatchId: string;
    coffeeName: string | null;
    coffeeRoaster: string | null;
    grinderId: string | null;
    grinderModel: string | null;
    grindSetting: string | null;
    rpm: number | null;
    dose: number | null;
    drink: number | null;
  };
  capturedAt: string;
  workflow: { context: Record<string, unknown> };
}

/** `equipment[]` (D7, KV_CONTRACT.md "equipment[]"): kit the manage page lists, custom fields user-defined. */
export interface Dye2Equipment {
  id: string;
  name: string;
  custom: Array<{ key: string; value: string }>;
  createdAt: string;
}

/** `baskets[]` (D7, KV_CONTRACT.md "baskets[]"). */
export interface Dye2Basket {
  id: string;
  name: string;
  size: 'single' | 'double' | 'triple' | 'bottomless' | 'other';
  diameterMm: number | null;
  notes: string | null;
  createdAt: string;
}

/** `recipes[]` (D7, KV_CONTRACT.md "recipes[]"): only the fields a consumer reads, dashboardVariables included. */
export interface Dye2Recipe {
  id: string;
  name: string;
  beverage: string;
  barista: string | null;
  drinker: string | null;
  beanId: string | null;
  beanName: string | null;
  profileId: string | null;
  profileTitle: string | null;
  showOnStreamlineDashboard: boolean;
  dashboardVariables: Record<string, unknown>;
  title: string;
  subtitle: string;
  capturedAt: string;
}

/** Two kit items, for a library that otherwise never shows any equipment. */
export function seedDye2Equipment(createdAt: string): Dye2Equipment[] {
  return [
    { id: 'eqp-wdt-tool', name: 'WDT tool', custom: [], createdAt },
    { id: 'eqp-acaia-lunar', name: 'Acaia Lunar scale', custom: [{ key: 'Model', value: 'Lunar 2021' }], createdAt },
  ];
}

/** One basket, so a recipe or favourite can plausibly reference one by id. */
export function seedDye2Baskets(createdAt: string): Dye2Basket[] {
  return [{ id: 'bskt-vst-18', name: 'VST 18g', size: 'double', diameterMm: 58, notes: null, createdAt }];
}

/** One saved recipe for `bean`, in DYE2's dashboard-slot shape (id '1'..'5'). */
export function seedDye2Recipes(bean: Bean, capturedAt: string): Dye2Recipe[] {
  const name = 'Morning Espresso';
  return [
    {
      id: '1',
      name,
      beverage: 'espresso',
      barista: null,
      drinker: null,
      beanId: null,
      beanName: bean.name ?? null,
      profileId: null,
      profileTitle: 'D-Flow / default',
      showOnStreamlineDashboard: true,
      dashboardVariables: {
        dose: 18,
        drink: 36,
        brewC: 93,
        steamMode: 'auto',
        steamTimeS: 20,
        steamFlowMls: 0.8,
        flushS: 2,
        hotWaterMode: 'auto',
        hotWaterMl: 150,
        hotWaterTempC: 85,
        grind: '4.2',
        rpm: null,
        grinderId: null,
        grinderModel: 'Niche Zero',
        basketId: null,
        basketName: null,
      },
      title: name,
      subtitle: bean.name ?? '',
      capturedAt,
    },
  ];
}

interface SetupSeed {
  profileTitle: string;
  grinderModel: string;
  grindSetting: string;
  dose: number;
  drink: number;
  rpm: number | null;
}

const SETUPS: readonly SetupSeed[] = [
  { profileTitle: 'D-Flow / default', grinderModel: 'Niche Zero', grindSetting: '4.2', dose: 18, drink: 36, rpm: null },
  { profileTitle: 'Londonium', grinderModel: 'Niche Zero', grindSetting: '4.5', dose: 18, drink: 38, rpm: null },
];

/**
 * Two recent setups for `bean`'s `batch`, newest first, captured at
 * `capturedAt[i]` (ISO timestamps, caller's choice so they land relative to
 * the mock's clock). `auto: true` recents never carry a recorded `profile`
 * here (the mock has none to attach), matching DYE2's own rule of attaching
 * one only when it is executable.
 */
export function seedDye2RecentFavourites(bean: Bean, batch: BeanBatch, capturedAt: readonly string[]): Dye2RecentFavourite[] {
  return SETUPS.map((setup, index) => {
    const sourceShotId = `cafai-mock-recent-${index}`;
    const context: Record<string, unknown> = {
      beanBatchId: batch.id,
      coffeeName: bean.name ?? null,
      coffeeRoaster: bean.roaster ?? null,
      grinderId: null,
      grinderModel: setup.grinderModel,
      grinderSetting: setup.grindSetting,
      targetDoseWeight: setup.dose,
      targetYield: setup.drink,
    };
    return {
      id: `recent:${sourceShotId}`,
      auto: true,
      recentRank: index,
      sourceShotId,
      title: bean.name ?? 'Recent shot',
      subtitle: [bean.roaster, setup.profileTitle, setup.grinderModel].filter(Boolean).join(' · '),
      beverage: '',
      alwaysOnDashboard: false,
      favSlot: null,
      copyMask: {
        profile: true,
        beans: true,
        grinder: true,
        grindSetting: true,
        dose: true,
        drink: true,
        roastDate: false,
        basket: false,
        equipment: false,
        barista: false,
        drinker: false,
        note: false,
      },
      snapshot: {
        profileTitle: setup.profileTitle,
        beanBatchId: batch.id,
        coffeeName: bean.name ?? null,
        coffeeRoaster: bean.roaster ?? null,
        grinderId: null,
        grinderModel: setup.grinderModel,
        grindSetting: setup.grindSetting,
        rpm: setup.rpm,
        dose: setup.dose,
        drink: setup.drink,
      },
      capturedAt: capturedAt[index] ?? capturedAt[0] ?? new Date().toISOString(),
      workflow: { context },
    };
  });
}
