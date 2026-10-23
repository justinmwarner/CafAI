# Drink scenes and going back by itself: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each drink's dial draws one of several animated scenes (the barista's choice in Settings > Drink screens) that follow the machine's numbers, and a drink's view goes back by itself after a countdown the barista can turn off, change or stop.

**Architecture:** Scenes are small canvas-drawing objects (`update(dt, input)`, `draw(frame, input)`) fed one `SceneInput` a frame by `SceneCanvas.tsx`, a canvas under the dial's SVG ring. Their colours are new palette roles (`palette.scene`) mixed in OKLab. The choices live in `Settings.drinkScreens`, read through a live store (`src/app/drinkScreens.ts`) as the temperature unit's is; the countdown is a pure reducer (`drinkReturn.ts`) driven by a hook in `DrinkView.tsx`.

**Tech Stack:** React 19, MUI 7, TypeScript (strict, `erasableSyntaxOnly`), Canvas 2D as Chromium 91 has it, Vitest + Testing Library (jsdom), Playwright (mock Decaid).

**Spec:** [2026-10-22-drink-scenes-design.md](../specs/2026-10-22-drink-scenes-design.md). **Mockup (the reference drawing code):** [2026-10-22-drink-scenes.mockup.html](../specs/2026-10-22-drink-scenes.mockup.html), whose `<script>` holds a working canvas version of every new scene (classes `Spray`, `Whirl`, `Art`, `Pour`, `Above`, `Shower`, `ScreenBelow`).

**Branch:** `feat/drink-scenes`, worktree `E:\source\cafai-drink-scenes`. Decisions were cited as tokens (`D-SCENE-n`, `D-BACK-n`) while the builders worked, and numbered at the merge: D217-D220 (the scenes) and D221-D222 (going back by itself), after usage sharing's D210-D216.

---

## File structure

| File | Responsibility | Task |
|---|---|---|
| `src/ui/color.ts` | + `Oklab`, `hexToOklab`, `oklabToRgb`, `mixOklab` | 1 (done) |
| `src/ui/palette.ts`, `palette.test.ts`, `theme.ts` | + `ScenePalette` roles, contrast pairs, `theme.palette.cafai.scene` | 1 (done) |
| `src/ui/drinks/scenes/types.ts` | `SceneInput`, `SceneSets`, `SceneFrame`, `Scene`, `SceneFactory` | 1 (done) |
| `src/ui/drinks/scenes/catalog.ts` | each drink's scene ids and names, `defaultScene`, `sceneFor` | 1 (done) |
| `src/ui/drinks/scenes/colors.ts` | `SceneColors` (OKLab), `sceneColors`, `themeColorSource`, `css`, `warmthColor` | 1 (done) |
| `src/ui/drinks/scenes/canvas.ts` | box constants, `FIGURES`/`CHECK` cut-outs, `drawFiguresMask`, `smooth`, `ease`, `clamp`, `Puff`, `movePuffs`, `drawPuff`, `blankScene` | 1 (done) |
| `src/ui/drinks/scenes/registry.ts` | id to factory, `createScene` | 1 (done) |
| `src/ui/drinks/scenes/testing/{stubContext,sceneRun}.ts` | a recording 2D context that throws as a browser would; a made-up run | 1 (done) |
| `src/ui/drinks/scenes/steam/*.ts` (4) | Wand and spray, Whirlpool, Rosetta, Simple | 2 |
| `src/ui/drinks/scenes/sceneInput.ts` | the numbers a scene follows, from the run, target and sets | 2 |
| `src/ui/drinks/scenes/SceneCanvas.tsx` | the canvas, its loop, masks, layers | 2 |
| `src/ui/drinks/DrinkDial.tsx` | the dial with SceneCanvas, the arc in the warmth colour, the check placed above | 2 |
| `src/ui/drinks/scenes/hotWater/*.ts`, `flush/*.ts` (6) | Pour, From above, Simple; Shower, Screen, Simple | 3 |
| `src/ui/drinks/drinkReturn.ts`, `useDrinkReturn.ts` | the countdown's rules and its timers | 4 |
| `src/ui/drinks/DrinkView.tsx`, `drinkFocus.ts`, `useDrinkFocus.ts` | Stay and the counting Go back; going back with the tap guard | 4 |
| `src/storage/{types,settings,schema}.ts` | `Settings.drinkScreens`, normalised, patched by field, merged whole | 1 (done) |
| `src/app/drinkScreens.ts`, `types.ts`, `createServices.ts` | the live store, in services, reloaded after a restore | 1 (done) |
| `src/ui/drinks/useDrinkScreens.ts` | `useDrinkScreen(kind)`, `useDrinkScreenChoices()`, `useDrinkScreensStore()` | 1 (done) |
| `src/ui/settings/DrinkScreensSection.tsx`, `SettingsScreen.tsx` | Settings > Drink screens | 5 |
| `e2e/drink-views.spec.ts` | going back by itself, Stay | 4 |
| `e2e/drink-screens.spec.ts` (new) | the section, a scene picked, the switch off | 5 |
| `DESIGN.md`, `DECISIONS.md`, `README.md`, `CHANGELOG.md`, `PRODUCT.md`, `docs/HARDWARE_TEST_PLAN.md` | the record | 6 |

Each of tasks 2-5 owns its files: a task never edits another's. `src/ui/testIds.ts` already has every new id (task 1).

---

### Task 1: Foundation (done in the first commit on `feat/drink-scenes`)

The contracts every other task builds on. Read them before starting any task:

- `src/ui/drinks/scenes/types.ts`: `SceneInput { kind, phase, live, progress, strength, heat, warmth }`; `ScenePhase` (`idle`, `heating`, `working`, `paused`, `purging`, `rinsing`, `done`, `lost`); `SceneSets { flow, temperature }`; `SceneFrame { ctx, colors, mode, still, done, layer(), cutFigures(amount), blit() }` (ctx already clipped to the inside of the ring, in the 272 box); `Scene { update(dt, input), draw(frame, input), settling() }`; `SceneFactory = (random?: () => number) => Scene`.
- `catalog.ts`: steam `spray`, `whirlpool`, `rosetta`, `simple`; hot water `pour`, `above`, `simple`; flush `shower`, `screen`, `simple`; `sceneFor(kind, id)` reads anything else as the default.
- `colors.ts`: `SceneColors` holds every `palette.scene` role in OKLab plus `background`, `inkMuted`, `milkWash`, `waterWash`, `flow`, `steamStrength` (dark 1.3, light 1.5) and `sheenStrength` (dark 1, light 3). `mixOklab(a, b, t)`, `css(lab, alpha)`, `warmthColor(colors, warmth)`. Build them with `sceneColors(themeColorSource(theme))` in React, `sceneColors(paletteColorSource(palette))` in tests.
- `canvas.ts`: `BOX` 272, `C` 136, `INSIDE` 99, `TAU`; `FIGURES` and `CHECK` cut-outs; `drawFiguresMask(ctx, px, done)`; `smooth`, `ease`, `clamp`; `Puff`, `movePuffs(puffs, dt, t)`, `drawPuff(ctx, puff, color, strength)`; `blankScene()`.
- `registry.ts`: `createScene(kind, id, random?)`; each scene file exports its factory (`createSpray`, `createWhirlpool`, `createRosetta`, `createSimpleSteam`, `createPour`, `createAbove`, `createSimpleHotWater`, `createShower`, `createScreen`, `createSimpleFlush`), today a `blankScene()`.
- `testing/stubContext.ts`: `stubContext()` records every call, throws on a negative radius, a non-finite number or `roundRect`; `stubFrame({ mode, still, done })`; `drawCalls(ctx)`. `testing/sceneRun.ts`: `sceneRun(kind, { workS, strength, heat, afterS })` gives one `SceneInput` per `FRAME_S` (1/60 s) through heating, work, steam's purge and done.
- Palette: `palette.scene` (`warmCold`, `warmHot`, `milkCold`, `milkWarm`, `foam`, `steam`, `steel`, `steelLight`, `steelDark`, `steelHole`, `swirlCold`, `swirlWarm`, `swirlFoam`, `swirlTrough`, `sheen`, `crema`, `cremaRim`, `cremaLight`, `artCold`, `artWarm`, `waterCold`, `waterWarm`, `waterLineCold`, `waterLineWarm`, `shallow`, `deep`, `ripple`, `flushCold`, `flushWarm`, `screen`, `screenBevel`, `screenHole`), the mockup's colours under these names (the mockup's `diskCold` is `swirlCold`, `foamB` `swirlFoam`, `troughB` `swirlTrough`, `foamA` `foam`, `steelHi`/`steelLo`/`hole` `steelLight`/`steelDark`/`steelHole`, `cremaHi` `cremaLight`, `ringLine` `ripple`, `screenSteel` `screen`, `arcCold`/`arcWarm` `warmCold`/`warmHot`). The contrast sweep checks the fills under the figures.
- Settings: `Settings.drinkScreens` (`{ steam?: { scene?, goBack?, goBackSeconds? }, hotWater?: …, flush?: … }`); `normalizeDrinkScreens`, `GO_BACK_SECONDS` (5-60), `DRINK_SCREEN_KINDS` in `src/storage/settings.ts`; `createDrinkScreensStore` and `resolveDrinkScreens` in `src/app/drinkScreens.ts` (defaults: scene null meaning the drink's default, `goBack` true, `goBackSeconds` 10); `services.drinkScreens` (optional on `Services`, always in fakes); `useDrinkScreen(kind)` gives `{ scene, goBack, goBackSeconds }` with the scene resolved.
- `DrinkDial` takes `scene` and `presets` props (DrinkView passes them) and sets `data-scene`.
- Test ids: `drinkStay`, `drinkGoBackSeconds`, `drinkScreens`, `drinkScene(kind)`, `drinkGoBackSwitch(kind)`, `drinkScreensError`.
- Lint: canvas `roundRect` is refused (Chromium 99+).

### Task 2: The scene engine, the steam scenes, the dial

**Files:**
- Create: `src/ui/drinks/scenes/sceneInput.ts`, `sceneInput.test.ts`, `SceneCanvas.tsx`, `SceneCanvas.test.tsx`, `steam/steam.test.ts`
- Modify (replace the blank body): `src/ui/drinks/scenes/steam/spray.ts`, `whirlpool.ts`, `rosetta.ts`, `simple.ts`
- Modify: `src/ui/drinks/DrinkDial.tsx` (and `DrinkView.test.tsx` only where a dial assertion changes)
- Never touch: `DrinkView.tsx`, `drinkFocus.ts`, `useDrinkFocus.ts`, `hotWater/*`, `flush/*`, settings and storage files, `palette.ts`.

- [ ] **Step 1: `sceneInput.ts`, test first.** Two pure functions (spec section 3):

```ts
/** What the drink was set to, from the machine's live settings before Decaid's workflow (as drinkModel.ts reads targets). */
export function sceneSets(kind: DrinkKind, shotSettings: ShotSettings | null, presets: DrinkPresets | null, frame: MachineFrame | null): SceneSets;
/** The numbers a scene follows now. `target` is what the dial counts toward (drinkTarget), or null. */
export function sceneInput(kind: DrinkKind, run: DrinkRun | null, target: number | null, sets: SceneSets): SceneInput;
```

`sceneSets`: steam flow `presets.steamSettings.flow`, temperature `steamTemperatureSet(shotSettings, presets)` (null when steam is off); hot water flow `presets.hotWaterData.flow`, temperature `shotSettings.targetHotWaterTemp ?? presets.hotWaterData.targetTemperature`; flush flow `presets.rinseData.flow`, temperature `frame.targetGroupTemperature ?? presets.rinseData.targetTemperature`. A value that is not a positive finite number is null.

`sceneInput`: phase from `run` (null run: `idle`; `run.lost`: `lost`; not live: `done`; live: from `run.latest.state` / `substate`: `preparingForShot` heating, `pausedSteam` paused, `puffing` purging, state `steamRinse` rinsing, else working). Progress: the dial's share (`run.elapsedS / target` for steam and flush, `run.waterMl / target` for hot water) clamped 0-1; with no target the run's time over 45 s (steam), 30 s (hot water) or 10 s (flush), capped at 1; 0 with no run. Strength: 0 unless working; else steam `(flow / (sets.flow ?? 0.8)) * (pressure / 1.8)`, hot water `flow / (sets.flow ?? 10)`, flush `flow / (sets.flow ?? 6)`, the frame's flow and pressure (null read as the set: flow as `sets.flow ?? default`, pressure as 1.8), clamped 0-2.2. Heat: steam `(steamTemperature - (set - 30)) / 30` with set `sets.temperature ?? 150` and a null reading as the set, clamped 0.2-1.15; hot water `((sets.temperature ?? 85) - 40) / 55` clamped 0-1; flush `(groupTemperature - (target - 20)) / 20` with target `sets.temperature ?? 93` and a null reading as `target - 20`, clamped 0-1. Warmth: steam progress; hot water and flush heat. Live: phase is heating, working, paused, purging or rinsing.

Tests (`sceneInput.test.ts`, node environment): build `DrinkRun` objects by hand (the interface in `drinkTrace.ts`) and frames from `IDLE_TELEMETRY.machine` (`src/ui/testing/fakeServices.ts`). Cover: each phase from its state and substate; progress with and without a target, capped; steam strength at the set flow and 1.8 bar is 1, at double both is capped at 2.2, 0 while heating; null readings read as the set (strength 1, heat 1 for steam at its set); hot water heat at 40 and 95 °C is 0 and 1 and warmth equals it; flush heat at target-20 and target is 0 and 1; `sceneSets` prefers the live settings and drops a zero, negative or NaN set.

Run: `npx vitest run src/ui/drinks/scenes/sceneInput.test.ts` (expect FAIL first, then PASS).

- [ ] **Step 2: `SceneCanvas.tsx`.** Props: `{ kind: DrinkKind; scene: string; run: DrinkRun | null; target: number | null; sets: SceneSets; size: number }`. It renders one `<canvas aria-hidden>` filling the dial (absolutely positioned, under the SVG), its backing store `round(size * min(2, devicePixelRatio))` square, and:
  - makes `createScene(kind, scene)` again whenever `kind`, `scene` or the run's `id` changes (a fresh scene per run);
  - keeps the newest props in refs (frames never re-render React: D148/D149);
  - draws with `getContext('2d')`; with none (jsdom) it draws nothing and starts no loop;
  - each draw: clear, set the transform to `(px / 272)`, clip to the circle `C, C, INSIDE`, build a `SceneFrame` (`colors` from `sceneColors(themeColorSource(useTheme()))`, `mode`, `still`, `done: run !== null && !run.live`, `layer()` handing out one offscreen canvas of the same size, cleared and in the same transform, `cutFigures(amount)` laying the right mask (made once per size with `drawFiguresMask`, a live one and a done one) over the layer with `destination-out` at `globalAlpha = amount`, `blit()` drawing the layer onto the canvas), then `scene.draw(frame, sceneInput(...))`;
  - runs a `requestAnimationFrame` loop while the run is live, and after it ends for as long as `scene.settling()` (at most 3 s), calling `scene.update(dt, input)` then drawing; `dt` is the time since the last frame in seconds, clamped to 0-0.05 (a frame stamped before the loop began must not run a scene backwards);
  - under `prefers-reduced-motion: reduce` (matchMedia, listened to) runs no loop and never calls `update`: it draws once on mount, on every `trace.onData` for the run, and when the run ends; the frame's `still` is true;
  - pauses the loop while `document.visibilityState === 'hidden'` and resumes on `visibilitychange`;
  - with no run, draws one frame (phase `idle`) and stops.

Test (`SceneCanvas.test.tsx`, jsdom): renders a canvas, aria-hidden, at the size's backing store; with `HTMLCanvasElement.prototype.getContext` stubbed to return `stubContext()` (restore after) and `requestAnimationFrame` faked with `vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'performance'] })` or a manual queue: a live run's frames call the scene's `update` and `draw` (spy on a scene by mocking `createScene` with `vi.mock('./registry.ts')`), a finished run with `settling() === false` stops the loop, reduced motion (stub `matchMedia` to match) never calls `update` and draws on `trace.onData`; unmounting cancels the frame.

- [ ] **Step 3: the steam scenes, test first.** Port the mockup's `Spray` to `steam/spray.ts`, `Whirl` to `whirlpool.ts`, `Art` to `rosetta.ts` (12 leaves), as classes or closures, in TypeScript, with these differences from the mockup:
  - the frame is already clipped (drop `clipInside`); draw on `frame.ctx`; use `frame.layer()`, `frame.cutFigures(0.9)` for steam and vapour (1 for anything else that moves and every line), `frame.blit()`;
  - colours from `frame.colors` (OKLab) with `css()` and `mixOklab()`: the mockup's `P.milkCold` is `colors.milkCold` and so on (see task 1's name map); `P.steamA` is `colors.steamStrength`, `P.sheenA` `colors.sheenStrength`; the mockup's `rgb(...)`/`rgba(...)` become `css(...)`;
  - `input.progress` where the mockup reads `st.share`, `input.warmth` for `st.warmth`, `input.strength`, `input.heat`; `st.phase === 'working'` stays, and the mockup's `'purging'` and `'heating'` map to the same phases; treat `paused` as working with strength 0, `rinsing` as purging;
  - `random` from the factory argument (default `Math.random`), never `Math.random` directly;
  - puffs through `Puff`, `movePuffs` and `drawPuff`;
  - `settling()`: Spray while puffs remain after the run (cap at 3 s of settling); Whirlpool while its spin (`s`) is above 0.02 or its fade is moving; Rosetta while the pull-through is below 1;
  - under `frame.still` draw the still form the mockup draws with `d.still` (no particles, the leaves at their target);
  - Rosetta in dark mode does not draw a halo itself: DrinkDial gives the figures their crema halo (step 4).
  - `steam/simple.ts`: today's scene from `DrinkDial.tsx` before this change (`git show HEAD~1:src/ui/drinks/DrinkDial.tsx`, or the base commit): the milk wash body with its wave on the floor rising `MILK_FROM + MILK_RISE * progress`, its surface line in ink-muted at 0.55, three wisps rising every 3.6 s (1.2 s apart), the wave sliding one 80-unit length in 2.2 s; lines cut behind the figures; still: the milk and its surface, no wisps.

`steam/steam.test.ts` (node environment, one block per scene, `seeded` random `(seed = (seed * 16807) % 2147483647) / 2147483647`):

```ts
for (const [name, make] of [['Wand and spray', createSpray], ['Whirlpool', createWhirlpool], ['Rosetta', createRosetta], ['Simple', createSimpleSteam]] as const) {
  describe(name, () => {
    it('updates and draws through a whole run in both modes without a call a browser would refuse', () => {
      for (const mode of ['dark', 'light'] as const) {
        const scene = make(seeded(7));
        for (const input of sceneRun('steam')) {
          scene.update(FRAME_S, input);
          const frame = stubFrame({ mode, done: input.phase === 'done' });
          scene.draw(frame, input);
          expect(drawCalls(frame.ctx) + drawCalls(frame.layerCtx)).toBeLessThan(5000);
        }
      }
    });
    it('draws while the steam works, and cuts what moves out behind the figures', () => { /* a working input: drawCalls > 20, frame.cuts not empty */ });
    it('draws a still frame anywhere in a run without update', () => { /* stubFrame({ still: true }) at heating, mid-work, done: no throw, drawCalls > 0 */ });
    it('stops settling within 3 s of the run ending', () => { /* run sceneRun with afterS 4; settling() false by 3 s after done */ });
    it('follows strength: a strong steam draws more than a weak one', () => { /* Spray and Whirlpool only: sum drawCalls over 2 s of work at strength 0.4 and 1.8 */ });
  });
}
```

Run: `npx vitest run src/ui/drinks/scenes/steam` (FAIL against the blank scenes, then PASS).

- [ ] **Step 4: `DrinkDial.tsx`.** Replace the SVG scene (the `clipPath`, the milk, water, wisps, stream, screen and streaks, their CSS loops and the band mask) with `<SceneCanvas kind scene run target sets size />` placed before the `<svg>` (the SVG keeps the ticks, track, arc and tip, and must not paint a background over the canvas). `sets` is `sceneSets(kind, shotSettings, presets, run?.latest ?? null)` with `shotSettings` from `useTelemetry((s) => s.shotSettings)`, memoised. In the existing `draw()` (run on every recorded frame), set the arc's and the tip's colour: `css(warmthColor(colors, input.warmth))` with `input = sceneInput(kind, run, target, sets)`, written to `arc.style.stroke` and the tip circle's `style.fill`; remove the `.arc`'s and `.tip circle`'s ink and flow strokes from `dialStyles`. The done check: absolutely positioned 22.5% from the top, centred, so the number and its line do not move when it appears. Rosetta in dark mode: the figures (the number, its unit and the "of" line) get `textShadow: 0 0 1px C, 0 0 2px C, 0 0 3px C, 0 0 6px C, 0 0 12px C` where C is `theme.palette.cafai.scene.crema`. Keep `data-moving`, `data-scene`, the aria-label and every test id. Update the file's header comment (the scene is a canvas now; D217-D219).

Run the existing view tests: `npx vitest run src/ui/drinks` (fix only assertions that named the removed SVG parts).

- [ ] **Step 5: look at it.** Build the mock and run it on your own port: `npm run build:mock` then `npx vite preview --mode mock --outDir dist-mock --port 4181 --strictPort --host 127.0.0.1` (run in the background, stop it when done). With Playwright (`node_modules/playwright`), open `http://127.0.0.1:4181/?mockSpeed=4#/`, start steam with the machine row's Steam button, and screenshot the view at 962x602 in dark and light (Settings > Appearance, or set the stored appearance), mid-steam and done, for each steam scene (pick it through `services.drinkScreens` in `window`, or by writing `drinkScreens` into settings before load; ask in your report if neither is reachable). Save shots to `.verify/scenes/` (git-ignored) and Read them. Compare with the mockup (open it at `?t=30&play=0`). Fix what does not match: the figures must never have a line through them, and the milk must stay below the "of" line.

- [ ] **Step 6: verify and commit.**

```
npm run typecheck > .verify/t2-typecheck.log 2>&1; echo exit=$?
npx eslint src/ui/drinks > .verify/t2-lint.log 2>&1; echo exit=$?
npx vitest run > .verify/t2-test.log 2>&1; echo exit=$?
```

All three exit 0. Commit only your files: `git add src/ui/drinks/scenes/sceneInput.ts src/ui/drinks/scenes/sceneInput.test.ts src/ui/drinks/scenes/SceneCanvas.tsx src/ui/drinks/scenes/SceneCanvas.test.tsx src/ui/drinks/scenes/steam src/ui/drinks/DrinkDial.tsx` (plus `DrinkView.test.tsx` if changed), message `feat: the drinks' scenes on a canvas, the steam scenes and the ring in the warmth colour (D217-D219)`.

### Task 3: The hot water and flush scenes

**Files:**
- Modify (replace the blank body): `src/ui/drinks/scenes/hotWater/pour.ts`, `above.ts`, `simple.ts`; `src/ui/drinks/scenes/flush/shower.ts`, `screen.ts`, `simple.ts`
- Create: `src/ui/drinks/scenes/hotWater/hotWater.test.ts`, `src/ui/drinks/scenes/flush/flush.test.ts`
- Never touch: anything outside `src/ui/drinks/scenes/hotWater/` and `src/ui/drinks/scenes/flush/`.

- [ ] **Step 1: tests first**, as task 2's step 3 shows for steam, with `sceneRun('hotWater')` and `sceneRun('flush')`, for Pour, From above and Simple, and Shower, Screen and Simple: a whole run in both modes without a refused call and under 5000 calls a frame; drawing while it works with the figures cut; a still frame anywhere; settling over within 3 s; strength followed (Pour, From above, Shower, Screen: more drawing at strength 1.8 than at 0.4); for Shower and Screen, `heat` 0 and 1 give different stroke or fill colours (inspect the recorded `set strokeStyle` / `set fillStyle` calls). Run `npx vitest run src/ui/drinks/scenes/hotWater src/ui/drinks/scenes/flush` and see them fail against the blank scenes.

- [ ] **Step 2: port the scenes** from the mockup's `Pour`, `Above`, `Shower` and `ScreenBelow` classes, with the same differences task 2's step 3 lists (frame already clipped; `frame.layer()`, `cutFigures`, `blit()`; `frame.colors` in OKLab with `css` and `mixOklab`, the name map of task 1: the mockup's `waterLineCold` is `colors.waterLineCold`, `shallow`/`deep` as named, `ringLine` is `ripple`, `flushCold`/`flushWarm` as named, `screenSteel` is `screen`, `screenBevel` and `screenHole` as named, `foamA` is `foam`, `steelHi`/`steelLo`/`hole` are `steelLight`/`steelDark`/`steelHole`; `input.progress` for `st.share`; `random` from the factory). No `roundRect`: the shower screen's bar is two arcs and two lines, or a thick line with round caps. `settling()`: Pour while its drops, rings or bubbles remain (vapour keeps rising after: cap the settling at 3 s, then the vapour simply stops being animated); From above while rings remain (at most 3 s); Shower while splash drops remain; Screen while drops remain. Under `frame.still`, the still forms the mockup draws with `d.still` (Pour's stream drawn without moving while it works; Screen's every sixth hole with a drop).
  - `hotWater/simple.ts`: today's hot water scene (`git show <base>:src/ui/drinks/DrinkDial.tsx`, base below): the water wash body with a 4-unit wave in the flow's blue on its surface at `progress` of the inside's depth, under a dashed stream (4 wide, dashes 12 9, falling 24 units in 0.62 s) from y 30, cut behind the figures; the wave sliding in 4.2 s.
  - `flush/simple.ts`: today's flush scene: the shower screen as a 5 wide ink-muted bar from (104, 44) to (168, 44) and five dashed flow-blue streams (2 wide, dashes 9 15, 0.7 alpha) from y 54 to the floor, fanning out, at 0.7, 0.82 and 0.66 s a fall; gone once the water stops; cut behind the figures.

- [ ] **Step 3: look at them.** As task 2's step 5, on port 4182, with the mock's hot water and flush (the machine row's Hot water and Flush buttons), each scene in dark and light at 962x602, mid-run and done. Save to `.verify/scenes-water/` and Read them. Until task 2 lands, the dial does not draw scenes: also render each scene to a PNG yourself with a small Playwright page that loads the scene modules through Vite (`npx vite --port 4182` serves `src/`; a scratch HTML in `.verify/` that imports the scene, `sceneColors(paletteColorSource(buildPalette(...)))` and the canvas helpers, and steps it through `sceneRun`), and compare with the mockup.

- [ ] **Step 4: verify and commit** as task 2's step 6 (typecheck, `npx eslint src/ui/drinks/scenes`, `npx vitest run`), committing only `src/ui/drinks/scenes/hotWater` and `src/ui/drinks/scenes/flush`, message `feat: the hot water and flush scenes: Pour and From above, Shower and Screen, and Simple for each (D217, D218)`.

### Task 4: Going back by itself

**Files:**
- Create: `src/ui/drinks/drinkReturn.ts`, `drinkReturn.test.ts`, `useDrinkReturn.ts`, `useDrinkReturn.test.tsx`
- Modify: `src/ui/drinks/DrinkView.tsx`, `DrinkView.test.tsx`, `drinkFocus.ts` (and its test), `useDrinkFocus.ts`, `useDrinkFocus.test.tsx`, `src/ui/shell/AppShell.tsx` (only the `onGoBack` wiring), `e2e/drink-views.spec.ts`
- Never touch: `DrinkDial.tsx`, `scenes/*`, settings and storage files.

- [ ] **Step 1: `drinkReturn.ts`, test first.** A pure reducer (spec section 7):

```ts
export type ReturnState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'counting'; readonly runId: number; readonly until: number; readonly seconds: number }
  | { readonly kind: 'kept'; readonly runId: number };

export type ReturnEvent =
  /** The view saw this run live, then it ended. */
  | { readonly type: 'ended'; readonly runId: number; readonly lost: boolean; readonly goBack: boolean; readonly seconds: number; readonly now: number }
  /** Stay, a pointer down or key press in the view, the run's drink starting again, the setting turned off. */
  | { readonly type: 'kept' }
  | { readonly type: 'tick'; readonly now: number; readonly typing: boolean };

export interface ReturnStep { readonly state: ReturnState; readonly goBack: boolean }

export const IDLE_RETURN: ReturnState = { kind: 'idle' };
export function drinkReturn(state: ReturnState, event: ReturnEvent): ReturnStep;
/** Whole seconds left, rounded up, for the button; null unless counting. */
export function secondsLeft(state: ReturnState, now: number): number | null;
```

Rules: `ended` counts (`until = now + seconds * 1000`) only when `goBack` and not `lost`, else `idle`; `kept` turns counting into `kept` (and leaves the others); `tick` at or past `until`: with `typing`, `kept`; else `idle` with `goBack: true` (once). Tests: each rule, `secondsLeft` 10 at the start, 1 in the last second, null when not counting.

- [ ] **Step 2: `useDrinkReturn.ts`.** `useDrinkReturn(kind, run, screen: DrinkScreenView, goBack: () => void): { left: number | null; until: number | null; stay(): void; keep(): void }`. It watches the run (a ref of the last live run id it saw on this view): when that run stops being live, it dispatches `ended` with `run.lost`, `screen.goBack`, `screen.goBackSeconds`, `Date.now()`; a new live run (the drink starting again) dispatches `kept`; while counting it ticks every 250 ms (`setInterval`, cleared when not counting and on unmount) with `typing: isTextEntry(document.activeElement)` (`src/ui/shell/useShotFocus.ts`); a step with `goBack: true` calls `goBack()`. `stay()` and `keep()` both dispatch `kept`. Tests (jsdom, fake timers): counting starts at the end of a run the view saw live and not of one it never saw; Stay keeps; a focused textarea at zero keeps; at zero `goBack` is called once; a lost run never counts; the switch off never counts.

- [ ] **Step 3: `DrinkView.tsx`.** Use `useDrinkReturn(kind, run, screen, () => onGoBack({ auto: true }))` (`screen = useDrinkScreen(kind)`, already in the view). While counting (`left !== null`), the header's end holds **Stay** (a text button in the accent, 48 px, `TID.drinkStay`, its name "Stay on this screen") then **Go back** with, after its label, the seconds left (`TID.drinkGoBackSeconds`, "8 s", tabular figures, ink-muted, weight 550, `minWidth: '2.6em'`, right-aligned) and behind its content a fill in `cafai.accentSoft`, `transform-origin: left`, scaled from 1 to 0 with a CSS transition linear over the whole countdown (`transition: transform <seconds>s linear`, started on the next frame; under `prefers-reduced-motion: reduce` no transition and no fill). The root `Box` gets `onPointerDownCapture` and `onKeyDownCapture` that call `keep()` while counting (a press on Go back still goes, by its click). The phase status says, once the countdown starts, "Done. Going back to <where> in <n> seconds." (`goBackWords(back)` from `drinkFocus.ts`: "the coach", "the shot", "History", "Settings", "Machine care"); after Stay, "Done". Go back's accessible name stays `goBackLabel(back)`. Change the prop to `onGoBack(options?: { auto?: boolean }): void`. Update the header comment (D221).

- [ ] **Step 4: `useDrinkFocus.ts` and `drinkFocus.ts`.** `goBack(options?)`: with `auto`, set the 350 ms tap guard (`GUARD_MS`) exactly as a switch does, then `replaceRoute(goBackRoute(...))`; without, as today. Add `goBackWords(route)`. `AppShell.tsx` keeps passing `drinkFocus.goBack`. Tests: `useDrinkFocus.test.tsx` gains "going back by itself guards the pane it returns to" (guard set, route replaced); `drinkFocus.test.ts` covers `goBackWords`.

- [ ] **Step 5: `DrinkView.test.tsx`.** With fake timers: a steam that runs and ends counts down from 10 ("10 s" in `TID.drinkGoBackSeconds`), the status says "Done. Going back to Settings in 10 seconds.", and `onGoBack` is called with `{ auto: true }` after 10 s; Stay keeps the view (no call, no seconds, Go back still there); a click on a stepper keeps it; `services.drinkScreens.set('steam', { goBack: false })` before the run: Done and no countdown; a run that ends lost: no countdown; a view opened on a finished run: no countdown.

- [ ] **Step 6: e2e** in `e2e/drink-views.spec.ts` (the app's services are not on `window`; the mock compresses the drink, not the countdown, so these wait out the default 10 s: `test.setTimeout(60_000)`): "a steam that ends goes back to the coach by itself": start steam from the row, Done, "10 s" then fewer in `TID.drinkGoBackSeconds`, then `#/` within 14 s with the coach on screen. "Stay keeps the view": the countdown, Stay, then still on `#/steam` 12 s later, Go back without seconds. "a tap on the view keeps it": the countdown, a tap on the settings card's More, still on `#/steam` 12 s later. Run on your own port: `E2E_PORT=4183 npx playwright test e2e/drink-views.spec.ts` (all projects it runs in). Every earlier test in the file must still pass: each acts within a few seconds of Done, or taps the view.

- [ ] **Step 7: verify and commit**: typecheck, `npx eslint src/ui e2e`, `npx vitest run`, the drink e2e above; commit your files only, message `feat: a drink's view goes back by itself once done, counting down on Go back, with Stay (D221)`.

### Task 5: Settings > Drink screens

**Files:**
- Create: `src/ui/settings/DrinkScreensSection.tsx`, `DrinkScreensSection.test.tsx`, `e2e/drink-screens.spec.ts`
- Modify: `src/ui/settings/SettingsScreen.tsx` (place the section after `DrinkSettingsSection`), `playwright.config.ts` (add `drink-screens` to `PHONE_SPECS`)
- Never touch: `DrinkView.tsx`, `DrinkDial.tsx`, `scenes/*`, storage and `src/app` files.

- [ ] **Step 1: the section, test first** (spec section 6). `DrinkScreensSection` reads `useDrinkScreenChoices()` and writes through `useDrinkScreensStore()` (`src/ui/drinks/useDrinkScreens.ts`). Layout as `DrinkSettingsSection.tsx`: `Section` titled "Drink screens", the help line "What each drink's screen shows while it runs, and whether it goes back by itself once it's done. Kept on this device." in body2 ink-muted; groups per drink in `DRINK_KINDS` order with the machine row's icon and name (reuse `drinksFor(...)`'s icons or the same `AirRounded`, `ShowerRounded`, `WaterDropRounded`), side by side from `sm`, stacked below. In each group:
  - **Animation**: a native select (the pattern of `FunFactsRow.tsx`), 48 px, `TID.drinkScene(kind)`, its options `SCENES[kind]` by name, its value `sceneFor(kind, choice.scene)`; a change calls `store.set(kind, { scene })`.
  - **Go back by itself**: an MUI `Switch` in a `FormControlLabel` with `sx={{ minHeight: 48, mr: 0 }}` (as `SleepWakeSection.tsx`), input test id `TID.drinkGoBackSwitch(kind)`, its name "Go back by itself after Steam" (the drink's name); a change calls `store.set(kind, { goBack })`.
  - While on: **After**, `DrinkField` (`src/ui/settings/DrinkFields.tsx`) with a spec `{ key: 'goBackSeconds', label: '<Drink> go back after', shortLabel: 'After', unit: 's', spokenUnit: 'seconds', integer: true, step: 5, range: { min: 5, max: 60 } }` (check `DrinkFieldSpec` in `drinkSettings.ts` for its exact fields), loaded, never disabled, its commit calling `store.set(kind, { goBackSeconds })`; the section's layout prop as the drinks' section passes it. While off: "The screen stays until you tap Go back." in body2 ink-muted, in the same place.
  - A rejected `set` shows "Could not save the drink screens: <message>" in an error Alert under the help line (`TID.drinkScreensError`), cleared by the next successful change.
  
  Tests (jsdom, `renderWithServices` with `createFakeServices()`): the three groups with their defaults (Wand and spray, Pour, Shower; switches on; After 10 s); picking Whirlpool saves `{ steam: { scene: 'whirlpool' } }` (read `services.storage.settings.get()`); the switch off hides After and shows the line; More on After saves 15; a failed save (make `services.storage.settings.update` reject) shows the Alert and keeps the change on screen.

- [ ] **Step 2: place it** in `SettingsScreen.tsx` after the drinks' section; the Settings screen's own tests must still pass (`npx vitest run src/ui/settings`).

- [ ] **Step 3: e2e** (`e2e/drink-screens.spec.ts`): open Settings, pick Whirlpool for steam, start steam from the machine row, the dial says `data-scene="whirlpool"`; turn flush's switch off, run a flush (the row's Flush), Done shows and no countdown (`TID.drinkGoBackSeconds` count 0) after 3 s; the phone project lays the groups out one row per setting. Run `E2E_PORT=4184 npx playwright test e2e/drink-screens.spec.ts`.

- [ ] **Step 4: verify and commit**: typecheck, `npx eslint src/ui/settings e2e playwright.config.ts`, `npx vitest run`, the new e2e; commit your files only, message `feat: Settings > Drink screens: each drink's animation and going back by itself (D217, D222)`.

### Task 6: The record, the review and the merge (the lead)

- [ ] Cherry-pick tasks 2-5's commits onto `feat/drink-scenes`; run typecheck, lint, every unit test, the build, the release zip and every e2e (`npm run verify` on port 4174 with nothing else serving there).
- [ ] One review of the whole branch against the spec (a reviewer agent or `/code-review`), fixes applied.
- [ ] DECISIONS.md: a section "Drink scenes and going back by itself (2026-10-22)" with D217 (the scenes, per drink, chosen in Settings; the owner's answers), D218 (what the numbers drive; the ring in the warmth colour, changing D149's ink and flow blue), D219 (the canvas: loop only while working and settling, reduced motion still, the figures' cut-out, the check placed above, the rosetta's halo, Chromium 91's canvas), D220 (the palette roles and their contrast pairs; DESIGN's gradient rule's exception), D221 (going back by itself: when, the countdown, Stay, what stops it, the tap guard, the words; changes D146 at the owner's ask), D222 (Settings > Drink screens, storage, defaults on and 10 s). Then `node .verify/renumber-decisions.mjs <next>` (add `SCENE|BACK` to its families) once main's last number is known.
- [ ] DESIGN.md: The drinks' views (dial, scene, arc, check, Go back's countdown and Stay), a Drink screens entry beside Steam, hot water and flush, Motion (the scenes' loops, the drain), the gradient rule; PRODUCT.md's latte-art anti-reference (a drawn rosetta, the barista's pick, is the one latte art); README's Settings list; CHANGELOG; HARDWARE_TEST_PLAN (each scene on the tablet, smooth at 272 px; going back by itself).
- [ ] Merge into `main` as the memory "Land in main" says (merge main into the branch, verify, a merge commit with main first, a guarded `update-ref`); push only when the owner asks.
