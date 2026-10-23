# Screensavers: design

Date: 2026-10-22. Status: approved by the owner (2026-10-22): eight
screensavers, a tap wakes the machine, the screen held on, dimmed, for 30
minutes, shown only while the machine sleeps, and "A different one each day"
for anyone who never opens Settings. Built in steps: first the host and six
screensavers, then a check-in with the owner (results and token spend)
before Espresso Pipes and Latte Art. Decisions D-SAVER-1 to D-SAVER-6,
numbered at the merge.

## 1. The ask

From the owner: "I want to add screensavers. I'd like to play off of the
mash up of old screensavers (ie: the DVD icon bouncing, the pipes, etc.) and
coffee, espresso, latte art, etc. Maybe even some dynamic ones too, ie: latte
art simulator that shows different things done." Asked first for the options,
their complexity and the chance of each, then which to build, the owner chose
eight from fifteen: Nightstand, Bouncing Portafilter, Espresso Pipes,
Beanfield, Rising Steam, Lava Latte, Brew Rain and Latte Art. Not chosen:
Etching, Fact Marquee, Your Shots, Last Shot Replay, Roaster, Origins Globe
and Flying Moka Pots. Left out from the start: a 3D maze, a story with
characters, a slideshow of bag photos (CafAI keeps none), and Pong.

What already stood: a screensaver was on the roadmap (docs/ROADMAP.md);
Decaid has none, the skin owns it (docs/verified/01-platform.md, 10); the
other skins (streamline, MSL, decaid-zen) show theirs only while the machine
is confirmed asleep and wake it on a tap; PRODUCT.md rules out latte-art clip
art and wants a still for every animation.

## 2. What changes

- **A screensaver covers CafAI on the tablet** while Decaid confirms the
  machine is asleep and nobody has touched the screen for a minute (D-SAVER-1).
- **A tap clears it and wakes the machine**, as the Wake button does.
- **The tablet's screen stays on for 30 minutes, dimmed**, then goes black
  and is let go, for Android's own timeout to turn off (D-SAVER-2).
- **Settings > Screensaver**: on or off, which one (or a different one each
  day), and a Preview (D-SAVER-3).
- **Drawn in code, always dark, still under reduced motion** (D-SAVER-4).
- **Eight screensavers**, six in the first step (D-SAVER-5), Latte Art behind
  a gate of its own (D-SAVER-6).
- **PRODUCT.md and DESIGN.md** say the screensaver is the one place for play,
  and the one exception to the motion rules.

## 3. When it shows (D-SAVER-1)

| Thing | Rule |
|---|---|
| Where | Only inside Decaid's WebView (`services.host.insideDecaid`). Decaid's display API drives the tablet's screen, so CafAI open on a phone or a computer never shows one. Preview shows anywhere. |
| Asleep | Confirmed: the machine connected, Decaid reachable, and the state from its frames `sleeping` (`machineConnected && !unreachable && state === 'sleeping'` in the telemetry store). Never from CafAI's own commands. A machine that is off or not connected never raises it; Android's timeout applies then, as today. |
| Up | The screensaver is on in Settings, the machine is confirmed asleep, and nothing has touched the screen for 60 s: no `pointerdown` and no `keydown` on the window (the events the heartbeat counts). The minute keeps it from jumping up when the barista taps Sleep and goes on reading. At start, the minute counts from the page's load. |
| A tap | A `pointerdown` (or a key) on the screensaver is swallowed, as TapGuard swallows one, so it never lands on what is underneath; the screensaver goes, and CafAI calls the Wake button's `sleepWake()`, so its spinner and any error ("Couldn't wake the machine...") show where they always do. If no wake can be sent just then (`sleepWake` not enabled), the tap only clears the screensaver. |
| Down by itself | The machine is anything but confirmed asleep: woken by a wake time, the group head, another skin or Decaid's own screen, or the link dropped. Also when the screensaver is turned off in Settings. |
| Again | The tap is a touch, so the rule above brings it back only after another minute untouched with the machine still asleep (a wake that failed, say). |

## 4. The screen (D-SAVER-2)

CafAI opens Decaid's display socket, `/ws/v1/display`, only while it needs
it, and only inside Decaid. It is the first socket CafAI sends on; Decaid
sends the display's state (`brightness`, `requestedBrightness`,
`wakeLockEnabled`, `wakeLockOverride`) on connect and on every change, and
takes `{"command":"setBrightness","brightness":n}`,
`{"command":"requestWakeLock"}` and `{"command":"releaseWakeLock"}`. A wake
lock taken on the socket goes when the socket closes
(docs/verified/02-api.md; contract/decaid/spec/websocket_v1.yml).

| When | What CafAI does |
|---|---|
| It comes up | Opens the socket. From Decaid's first frame, remembers `requestedBrightness` (in localStorage, `cafai.saver.brightness`), unless one is remembered already, then sets the brightness to 30, or leaves it where it is when it is lower, and requests the wake lock: Decaid lets go of its own when the machine sleeps, so without one Android's timeout would blank the screen within minutes. |
| The socket reconnects | Requests the wake lock again (it went with the old socket) and sets the brightness again. |
| 30 minutes later | The animation stops and the screensaver turns black; the socket closes, which lets the wake lock go, so Android's own timeout turns the screen off. The brightness stays dimmed. |
| The page shows again | (The screen was turned back on, so Android showed the page again.) With the machine still asleep, the screensaver starts over: animating, dimmed, held on, another 30 minutes. |
| It goes | Opens the socket if it is closed, sets the brightness back to the remembered value (100 means Android's own, as Decaid reads it), releases the wake lock, forgets the remembered value and closes the socket. |
| CafAI starts | A remembered value left over (the page was unloaded while dimmed: Android does that after 10 minutes in the background) is put back while no screensaver is up, so a dim is never kept as if it were the barista's own brightness, and never "restored" to. Decaid resets the brightness to 100 when the skin closes; nothing to do then. |
| The socket fails | The screensaver still shows, only not dimmed and not held on. Nothing on screen says so: like the heartbeat, presence is a nicety, never worth an error. |

Preview never dims and never takes the wake lock.

## 5. Settings > Screensaver (D-SAVER-3)

A section of its own, after Sleep and wake, applied at once as the
temperature unit is (no Save):

- **Screensaver**, a switch: on by default.
- **Which**, one choice: "A different one each day" (the default), then
  Nightstand, Bouncing Portafilter, Beanfield, Rising Steam, Lava Latte and
  Brew Rain (Espresso Pipes and Latte Art when they are built).
- **Preview**: shows the chosen one now, full screen (for "A different one
  each day", today's). A tap closes it; it never wakes the machine.
- A line under the choice: "Shows once the machine has been asleep and the
  screen untouched for a minute. A tap wakes the machine. The screen stays
  on, dimmed, for 30 minutes." Outside Decaid it adds "Only on the Decent
  tablet: here, Preview shows it."
- A screensaver that needs WebGL, on a device where WebGL cannot start, is
  greyed out with a line saying so, and "A different one each day" skips it.

**A different one each day**: the screensavers this device can run, in a
fixed shuffled order, one a day by the local calendar day
(`localDayNumber`), so each comes round in turn and none twice in a row. The
day's number is also the seed, so each day's picture differs a little.

The setting is `Settings.screensaver`: `{ on: boolean, pick: SaverId |
'daily' }`, absent until someone changes it on this device and read as
`{ on: true, pick: 'daily' }`, so a merge (an import, a restore) can tell a
choice made here from none, as the temperature unit and the fun facts do. A
pick this build does not know reads as `'daily'`. It travels with the other
settings to Decaid's backup and the export.

## 6. How they look (D-SAVER-4)

- **Dark**: every screensaver draws with the dark palette of the barista's
  tint (`paletteFor({mode: 'dark', tint}, false)`), whatever their light or
  dark mode: a dim, dark screen is the point. The colours that carry meaning
  elsewhere (pressure green, flow blue) may be used as colours here.
- **Drawn in code**: no images, no fonts beyond Figtree and the device's own,
  no libraries. D10's one bundle stays small, and nothing is clip art.
- **Frames**: the host's loop (`runSaver`): at most 30 a second, a step by
  the time since the last frame (at most a tenth of a second), then a draw;
  paused while the page is hidden. A canvas backing scale of the device's
  pixel ratio, at most 1.5.
- **Seeded**: everything random comes from the seed (`createRandom`), and
  every change of state from the steps, so the same seed and steps give the
  same picture: a test or a screenshot can step to any moment.
- **Reduced motion** (`prefers-reduced-motion: reduce`): each screensaver
  paints its still instead (`still()`), again each minute; Nightstand jumps
  to its new place as always (a jump is not motion).
- **The exceptions**, written into PRODUCT.md and DESIGN.md: the screensaver,
  shown only while the machine sleeps and nobody is there, is the one place
  for play: classic screensavers redrawn with coffee, never clip art,
  mascots or novelty fonts; and its motion is the one exception to "short,
  150 to 250 ms, never bouncy".
- **Falls back**: a screensaver that cannot get its context, or throws, is
  replaced by Nightstand for the rest of that showing.

## 7. The screensavers (D-SAVER-5)

Each canvas screensaver is a module (`src/ui/saver/savers/<id>.ts`)
implementing `CanvasSaver` (`src/ui/saver/types.ts`): `create(canvas, env)`
gives an instance with `step(dtMs)`, `draw()`, `resize(width, height,
scale)`, `still()` and `dispose()`, or null when the canvas cannot give it its
context. `env` holds the palette, the seed and a few numbers from the last
shot. The registry (`src/ui/saver/registry.ts`) lists them in Settings' order.
Every one keeps to Chromium 91's canvas (no `roundRect`,
`createConicGradient`, `reset` or `letterSpacing`) and aims at under 4 ms a
frame on a desktop at 962×602 (the tablet is several times slower).

### The first step

| Screensaver | After | What it draws |
|---|---|---|
| **Nightstand** | A bedside clock | Text, drawn by React, not a canvas: the time, large (24-hour, as CafAI writes times); under it, when they are known, the next wake time from Decaid's wake times ("Wakes at 06:00"), the bag on the machine, and the last shot in one line as CafAI writes one elsewhere. The time in ink, the rest in muted ink. The block jumps to a new place each minute (seeded), well inside the edges, so nothing stays lit in one spot. |
| **Bouncing Portafilter** | The DVD logo | A badge: "CafAI" in Figtree, extra bold and italic, over a flat oval (about 4:1) with ESPRESSO in it in the page's colour: the DVD logo's layout, never its mark. About a fifth of the screen wide, it drifts at 70 px/s on both axes and bounces off the edges. Each wall it hits moves its colour one roast along: green, yellow, cinnamon, city, full city, Vienna, French, then green again, each light enough to read on the dark page (3:1 at least). A corner (both walls in the same frame) bursts a dozen small beans out of the corner, fading over 1.2 s, and "Corner 2" (the corners since it came up) shows small by the badge for 3 s. Still: the badge at a seeded place. |
| **Beanfield** | Starfield | About 180 beans in a deep box coming toward you, each from far to past you in about 8 s, then far away again at a new place. A bean is an oval (about 1.45:1) with a darker S-shaped crease along it, turning slowly and tumbling (one axis squeezed by the cosine of its own phase, so it flips). Seven roast colours from green to dark, each with a lighter rim so the dark ones show; far beans fade in from the page. Drawn from pre-drawn sprites. Still: the frame at 6 s. |
| **Rising Steam** | Flurry, Mystify | A cup's outline at the bottom centre (bowl, handle, the line of a saucer) in muted ink, about 180 px wide at 962. Steam rises from its rim: a few hundred particles going up at about 35 px/s, swirled by a curl-noise field that drifts slowly with time, each living 6 to 10 s and fading in and out, drawn as short strokes in ink at low alpha onto a canvas that fades a little toward the page each frame, so the wisps leave trails. No additive glow. Named so it is not taken for the Steam drink. Still: the frame at 12 s. |
| **Lava Latte** | The lava lamp | A tall glass from the side, a little tapered, about 70% of the screen's height, its outline in muted ink. Inside, coffee (a vertical gradient from a deep brown at the bottom to a lighter one at the top, both clear of the page) and seven to nine blobs of cream (off-white): warmed at the bottom they rise, cooled at the top they sink, wobbling sideways, merging and splitting, at about 15 px/s. Metaballs on a coarse grid (about 4 px a cell) with a soft edge, scaled up smoothly and clipped to the glass. Still: the frame at 20 s. |
| **Brew Rain** | The Matrix's falling code | Columns about 20 px apart; glyphs of 16 to 18 px; each column's head falls at 6 to 14 rows a second. The classic trail: each frame darkens the canvas a little toward the page and draws only the heads. The glyphs are the katakana of コーヒー, エスプレッソ, ラテ and カフェ, and digits; the head near-white, the trail in the pressure green. Every few seconds one column spells a word top to bottom instead (エスプレッソ, コーヒー, ラテ, カフェ) or one of the last shot's numbers. The katakana come from the device's own font (Android has one). Still: the frame at 8 s. |

### Later steps

| Screensaver | After | What it draws |
|---|---|---|
| **Espresso Pipes** | 3D Pipes | WebGL1, written by hand (no library). Copper, brass and chrome pipes grow through a 3D grid from a fixed camera; ball joints at the turns; about one joint in thirty is a coffee fitting instead (a pressure gauge, a valve wheel, a small cup); at 60% full or after 4 minutes it fades and starts again. Its still: one grown frame. |
| **Latte Art** | (its own) | See D-SAVER-6. |

## 8. Latte Art (D-SAVER-6, a later step)

The cup seen from above (its rim, a saucer, the handle). An unseen pitcher
pours, in turn, a heart, a tulip, a rosetta and a swan: about 25 s a pour, 12
s to admire it, its name small under the cup, then the cup clears for the
next.

- **The model**: no real fluid dynamics. A field of foam (0 to 1) over the
  cup's surface, moved each step by a velocity made from the pour: a source
  where the stream lands (foam surfaces only while the pitcher is low), the
  pitcher's motion and its wiggle pushing the surface, the pull-through as a
  narrow drag along its path, and the cup's wall taking the flow down. The
  crema's marbling moves with it. On the CPU at about 200×200 (Float32
  arrays, semi-Lagrangian steps with a little sharpening to keep the edges
  crisp): no WebGL risk, and the model can be unit-tested.
- **The choreographies**: each pour a timeline of the pitcher's place,
  height, flow and wiggle.
- **The gate**: the heart and the tulip first, tuned from screenshots, then
  judged by the owner on the tablet; the rosetta and the swan only after. A
  pour that does not look right is left out; if the heart and the tulip do
  not pass, Latte Art does not ship.

## 9. The parts

| Part | Where | What it does |
|---|---|---|
| The interface | `src/ui/saver/types.ts` | `SaverId`, `SaverEnv`, `SaverInstance`, `CanvasSaver`. |
| Random | `src/ui/saver/random.ts` | `createRandom(seed)`, `between`, `wholeBetween`, `pickOne`, `localDayNumber`. |
| The loop | `src/ui/saver/runner.ts` | `runSaver` (30 fps, pause, resume, stop, errors), `stepFor`, `sizeSaver`, `backingScale`. |
| The registry | `src/ui/saver/registry.ts` | `SAVERS` in Settings' order, `CANVAS_SAVERS`, `canvasSaver(id)`, `isSaverId`. |
| The policy | `src/ui/saver/policy.ts` | The rules of section 3 as pure functions, and the minute, the 30 minutes and the 30 of brightness as constants. |
| The day's pick | `src/ui/saver/daily.ts` | Section 5's "A different one each day". |
| The overlay | `src/ui/saver/SaverOverlay.tsx`, `SaverCanvas.tsx`, `Nightstand.tsx` | The last child of the shell's root, fixed over everything, top bar included: the tap, the canvas and its loop, the black after 30 minutes, the fallback, Preview. |
| The display socket | `src/api/display.ts` | One socket while wanted: state frames in, the three commands out, reconnecting from 1 s to 30 s; recorded in the traffic log as the other sockets are. |
| The screen | `src/app/saverScreen.ts` | Section 4: remember, dim, hold, let go, put back. |
| The setting | `src/storage/` (types, schema, settings), `src/app/` (a store as the temperature unit's), `src/ui/settings/ScreensaverSection.tsx` | Section 5. |
| Reduced motion | `src/ui/platform/usePrefersReducedMotion.ts` | As `usePrefersDark`, for the canvas, which CSS cannot still. |
| The dev preview | `dev/preview-saver.html`, `src/ui/preview/saverPreview.ts` | One screensaver on the whole window, by id, seed, moment, tint; for building and screenshots. |
| The mock | `mock/decaid/ws.ts`, `mock/decaid/state.ts` | `/ws/v1/display`: its state on connect, the commands taken and recorded for tests. |

## 10. Testing

- **Unit** (Node; jsdom has no canvas): the policy (every row of section 3,
  both sides of the minute), the day's pick (in turn, none twice running,
  skipping one that cannot run), the display socket (frames, commands,
  reconnecting), the screen (remember once, dim to 30 or less, hold, let go
  at 30 minutes, put back, a start with a value left over, a reconnect
  asking again), the setting (normalising, merging, the default), and each
  screensaver's model as pure code: the bounce's walls, corners and colour
  steps; the beans recycled in their box; the steam's particles on screen;
  the blobs inside the glass; the rain's columns and words.
- **e2e** (mock mode, Playwright's clock, inside Decaid as the e2e already
  pretends): asleep and a minute untouched shows it; a tap clears it, sends
  `PUT /machine/state/idle` and puts the brightness back and the wake lock
  away; the 30 minutes turn it black and let the lock go; awake, or on a
  phone, it never shows; turned off, it never shows; reduced motion shows the
  still; Preview shows and closes without a wake.
- **Screenshots**: Settings > Screensaver, and one frame of each screensaver
  at 962×602 at a fixed seed and moment.
- **Chromium 91**: each screensaver runs a few seconds in the smoke test's
  Chromium 91 without an error.
- **The tablet** (docs/HARDWARE_TEST_PLAN.md): each one's frame rate, the dim
  and the hold, the 30 minutes, a tap waking the machine, the page shown
  again after the screen was off, a reload while dimmed, and whether the
  katakana show.

## 11. The steps

1. **The host**: the policy, the overlay, the display socket and the screen,
   the setting and its section, Nightstand, the mock's socket, the e2e, and
   the docs (PRODUCT, DESIGN, DECISIONS, README, CHANGELOG, the hardware test
   plan, QUESTIONS).
2. **Five canvas screensavers**: Bouncing Portafilter, Beanfield and Brew
   Rain; Rising Steam and Lava Latte. Built beside step 1 against the
   interface and the dev preview.
3. A review, the checks (`npm run verify`, the Chromium 91 smoke), into
   `main`, and the check-in.
4. Later, as the owner says then: Espresso Pipes; Latte Art's heart and
   tulip, the owner's look, then its rosetta and swan.
