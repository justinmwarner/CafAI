# Screensavers: design

Date: 2026-10-22. Status: approved by the owner (2026-10-22): eight
screensavers, a tap wakes the machine, the screen held on, dimmed, for 30
minutes, shown only while the machine sleeps, and "A different one each day"
for anyone who never opens Settings. Built in steps: first the host and six
screensavers, then a check-in with the owner (results and token spend)
before Espresso Pipes and Latte Art. Decisions D223-D228,
numbered at the merge.

Round 2 (2026-10-24): having tried the six, the owner asked for the planned
two, for nicer visuals ("I do like a lot of them, but just want to make them
nicer") and for a Brew Rain that says coffee ("Brew Rain is just matrix,
nothing coffee related"). Every screensaver is now lit, not flat (D-SAVE-1),
Brew Rain is water brewing from a shower screen into a cup, and Espresso
Pipes and Latte Art are built, Latte Art's four pours at once (D-SAVE-2).
Sections 5 to 8 describe them as they are now; the decisions are D-SAVE,
D-RAIN, D-STEAM, D-PIPES, D-BEAN and D-LATTE in DECISIONS.md.

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
  machine is asleep and nobody has touched the screen for a minute (D223).
- **A tap clears it and wakes the machine**, as the Wake button does.
- **The tablet's screen stays on for 30 minutes, dimmed**, then goes black
  and is let go, for Android's own timeout to turn off (D224).
- **Settings > Screensaver**: on or off, which one (or a different one each
  day), and a Preview (D225).
- **Drawn in code, always dark, still under reduced motion** (D226).
- **Eight screensavers**, six in the first step (D227), Latte Art behind
  a gate of its own (D228).
- **PRODUCT.md and DESIGN.md** say the screensaver is the one place for play,
  and the one exception to the motion rules.

## 3. When it shows (D223)

| Thing | Rule |
|---|---|
| Where | Only inside Decaid's WebView (`services.host.insideDecaid`). Decaid's display API drives the tablet's screen, so CafAI open on a phone or a computer never shows one. Preview shows anywhere. |
| Asleep | Confirmed: the machine connected, Decaid reachable, and the state from its frames `sleeping` (`machineConnected && !unreachable && state === 'sleeping'` in the telemetry store). Never from CafAI's own commands. A machine that is off or not connected never raises it; Android's timeout applies then, as today. |
| Up | The screensaver is on in Settings, the machine is confirmed asleep and has been for 3 s without a break, and nothing has touched the screen for 60 s: no `pointerdown` and no `keydown` on the window (the events the heartbeat counts). The minute keeps it from jumping up when the barista taps Sleep and goes on reading. At start, the minute counts from the page's load. The 3 s (added after the review): across a dropped link the store keeps the last frame, which says asleep until a fresh one arrives. |
| A tap | A `pointerdown` (or a key) on the screensaver is swallowed, as TapGuard swallows one, so it never lands on what is underneath; the screensaver goes, and CafAI calls the Wake button's `sleepWake()`, so its spinner and any error ("Couldn't wake the machine...") show where they always do. If no wake can be sent just then (`sleepWake` not enabled), the tap only clears the screensaver. |
| Down by itself | The machine is anything but confirmed asleep: woken by a wake time, the group head, another skin or Decaid's own screen, or the link dropped. Also when the screensaver is turned off in Settings. |
| Again | The tap is a touch, so the rule above brings it back only after another minute untouched with the machine still asleep (a wake that failed, say). |

## 4. The screen (D224)

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

## 5. Settings > Screensaver (D225)

A section of its own, after Sleep and wake, applied at once as the
temperature unit is (no Save):

- **Screensaver**, a switch: on by default.
- **Which**, one choice: "A different one each day" (the default), then
  Nightstand, Bouncing Portafilter, Espresso Pipes, Beanfield, Rising Steam,
  Lava Latte, Brew Rain and Latte Art.
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

## 6. How they look (D226)

- **Dark**: every screensaver draws with the dark palette of the barista's
  tint (`paletteFor({mode: 'dark', tint}, false)`), whatever their light or
  dark mode: a dim, dark screen is the point. The colours that carry meaning
  elsewhere (pressure green, flow blue) may be used as colours here.
- **Lit, not flat** (D-SAVE-1, round 2): the light that draws a thing is
  allowed here, and only here: soft gradients for volume, a key light and a
  rim light, the sheen of metal, glass, glaze and oily beans, a soft glow
  where there is a light. Drawn for a screen dimmed to 30: the subject and
  any words at least 3:1 on the page, carried by midtones and lights, never
  by near-black detail. A fixed object (a cup, a glass) drifts a few pixels
  a minute, against burn-in.
- **Drawn in code**: no images, no fonts beyond Figtree and the device's own,
  no libraries. D10's one bundle stays small, and nothing is clip art.
  Canvas 2D, except Espresso Pipes, which draws with WebGL1 written by hand
  (D-PIPES-2).
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
  replaced by Nightstand for the rest of that showing. Since round 2 it also
  says so (D-SAVE-3): the overlay carries `data-fallback="1"`, and one line
  goes to the console, Decaid's WebView log on a tablet.

## 7. The screensavers (D227)

Each canvas screensaver is a module (`src/ui/saver/savers/<id>.ts`)
implementing `CanvasSaver` (`src/ui/saver/types.ts`): `create(canvas, env)`
gives an instance with `step(dtMs)`, `draw()`, `resize(width, height,
scale)`, `still()` and `dispose()`, or null when the canvas cannot give it its
context. `env` holds the palette, the seed and a few numbers from the last
shot. The registry (`src/ui/saver/registry.ts`) lists them in Settings' order.
Every one keeps to Chromium 91's canvas (no `roundRect`,
`createConicGradient`, `reset` or `letterSpacing`) and to WebKit's (no
`ctx.filter`, which Safari ignores before 18), and aims at under 4 ms a
frame on a desktop at 962×602 (the tablet is several times slower).

The first step (2026-10-22) drew six flat; round 2 (2026-10-24) lit them,
drew Brew Rain again as coffee and added Espresso Pipes and Latte Art. As they
are now, in Settings' order:

| Screensaver | After | What it draws |
|---|---|---|
| **Nightstand** | A bedside clock | Text, drawn by React, not a canvas (D-STEAM-3): the time large and light (24-hour, weight 300, tabular) over a very faint warm glow, the day small above it as the device writes one ("Friday 24 October", "Friday, October 24"). Under it, each under a hairline and each only when known: the next wake time from Decaid's wake times ("Wakes at 06:00"), the bag on the machine, and the last shot in one line as CafAI writes one elsewhere. The time in ink, the rest in muted ink. Each minute the block fades out (700 ms) and in (1.1 s) at a new seeded place, well inside the edges, so nothing stays lit in one spot; under reduced motion it jumps. |
| **Bouncing Portafilter** | The DVD logo | A logo (D-RAIN-4, D-RAIN-5): a portafilter from the side drawn as a logo mark (the group ring and its two lugs, the basket, a double spout with a drop under each nozzle, the handle and its collar) over "CafAI" in Figtree, extra bold and italic, over a flat 4:1 oval with ESPRESSO cut out in the page's colour: the DVD logo's layout, never its mark. A fifth of the screen wide, 0.88 as high; it drifts at 70 px/s on both axes and bounces off the edges. All in the roast's colour, each part lit softly from above, with a soft glow of its colour on the page. Each wall moves its colour one roast along, green to French and round again, crossing over in 300 ms, each at least 3:1 on the page. A corner (both walls in the same frame) sends a ring of warm light out of the screen's corner (gone in 0.9 s), bursts a dozen shaded beans out in front of the logo that grow a little and fade over 1.2 s, and shows "Corner 2" (the corners since it came up) small by the logo for 3 s. Still: the logo at a seeded place. |
| **Espresso Pipes** | 3D Pipes | WebGL1, written by hand, no library and no extension needed (D-PIPES-1 to D-PIPES-3). Polished copper, brass, chrome and dark anodised pipes grow through a 20×12×12 grid seen from a fixed camera a little above its middle, three to five at once, a cell every 80 to 120 ms, drawn out smoothly, with ball joints (1.45 times the pipe) at the turns; a pipe boxed in stops and another starts. About one turn in thirty is a coffee fitting: a pressure gauge (0 to 16 bar, its needle near 9) or a valve wheel facing the camera, or an espresso cup on its saucer where both pipes run level. The metals reflect a studio built in the shader (a warm key softbox, a cool fill, strips overhead and behind, a dark floor), with Fresnel; fog sinks the far pipes into the page colour. At 60% full or after 4 minutes it fades over 2.5 s and grows a new layout. Still: a layout grown to 42%, built once. |
| **Beanfield** | Starfield | About 180 roasted beans in a deep box coming toward you out of a soft warm glow in the middle (the roaster's drum light), each from far to past you in about 8 s (D-BEAN-1 to D-BEAN-3). Each bean is a lit solid, an oval 1.38:1 with a domed back and the centre cut down its flat side (a dark fold, its far slope lit): a warm key light from the upper left, a warm back light along its lower right edge, an oily glint broken by grain on the dark roasts. Each rolls slowly about its long axis, its angle on the screen kept but for a small wobble, so the light never moves on it. Seven stages: green coffee's grey-green, straw, cinnamon, city, full city, Vienna, French. Far beans hazy, near ones crisp, the fastest streaking a little. Drawn from sprites lit pixel by pixel (24 roll frames, 4 light angles, 4 sizes), made when first wanted and kept. Still: the frame at 6 s. |
| **Rising Steam** | Flurry, Mystify | A lit still life (D-STEAM-1, D-STEAM-2): a porcelain cup of coffee on its saucer at the bottom centre, about 175 px across the rim at 962, seen from 17.5° above, rendered once per size, per pixel: a warm white glaze with soft shading and a bright lip, a strip light's highlight, the inner wall in shade, dark coffee with a crema ring and a paler swirl, and the shadow on an unseen table. A warm key light behind and above it has its glow behind the steam. Steam leaves the coffee: a few hundred particles at about 35 px/s on a curl-noise flow, each living 6 to 10 s, laying fine filaments that fade in about a second and feeding a broad faint body that rises, spreads and fades over 2.4 s, both brighter where they cross the glow and fading with height; the cup's near side is laid over the steam. The whole scene drifts up to 6 px across and 3.5 px up and down over minutes. Named so it is not taken for the Steam drink. Still: the frame at 12 s, moved to the drift's next place each minute. |
| **Lava Latte** | The lava lamp | A tall tapered glass, about 70% of the screen's height, with thickness (D-BEAN-4 to D-BEAN-6): outer and inner edges, a faint tint, a heavy foot, a rim seen from slightly above, soft vertical streaks. Coffee under a thin layer of milk foam, and seven to nine blobs of cream that rise warm, sink cool and merge, at about 15 px/s: metaballs on a 4 px grid, shaded three times as fine from the field's slope. A warm light under the glass, as a lava lamp's bulb, glows through the foot, turns the coffee gold and amber deepening to espresso, lights the cream from below, and spills onto the page as a halo, a pool and a reflection where the glass stands. The glass drifts a few pixels a minute. Still: the frame at 20 s. |
| **Brew Rain** | The Matrix's falling code | Water falling from a group head's shower screen into a cup, brewing on its way (D-RAIN-1 to D-RAIN-3). Along the top, brushed steel with staggered rows of holes. Near columns (glyphs of 18 to 20 px) fall under the front row of holes, 32 px apart, at 5 to 11 rows of 24 px a second; far columns between them, smaller (12 to 13 px), slower, sparser and fainter. The classic trail. The glyphs are coffee's, drawn as paths: a bean, a drop, a cup, cherries, a leaf, steam, a latte-art heart (five near heads in six, every far one); the rest are the Latin letters and figures of coffee's words, in Figtree. A head goes from pale water at the top to crema gold and amber by the cup, glowing softly; its trail sinks through amber and espresso brown into the page. Every 3 to 6 s a near column spells a word (ESPRESSO, CREMA, RISTRETTO, ...), a brew number (9 BAR, 93°, 1:2) or one of the last shot's numbers, each letter lit 1.6 s, then fading. At the bottom the cup: crema over coffee on a slow wave, where each head drops in with rings and droplets; it fills from 12% to 18% of the height over 30 minutes. No katakana, so no font of the device's is needed. Still: the first moment from 8 s on when a word has just been spelled (14 s at the latest). |
| **Latte Art** | (its own) | See section 8. |

## 8. Latte Art (D228, a later step)

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
  still; Preview shows and closes without a wake. Since round 2, each canvas
  screensaver starts, held at 3 s and running, at each tablet size without
  giving way to Nightstand (D-SAVE-3).
- **Screenshots**: Settings > Screensaver, and one frame of each screensaver
  at 962×602 at a fixed seed and moment, none of them Nightstand standing in.
- **Chromium 91**: each screensaver runs a few seconds in the smoke test's
  Chromium 91, held, running and as its still, without an error and without
  giving way to Nightstand.
- **The tablet** (docs/HARDWARE_TEST_PLAN.md): each one's frame rate, the dim
  and the hold, the 30 minutes, a tap waking the machine, the page shown
  again after the screen was off, a reload while dimmed; since round 2, how
  each new look reads dimmed, and Espresso Pipes' and Beanfield's start and
  frame rate on a weak tablet.

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
5. **Round 2** (2026-10-24, after the owner tried the six): five builders
   side by side, each in a worktree of its own, judging its work from
   screenshots: Brew Rain and the Bouncing Portafilter; Rising Steam and
   Nightstand; Beanfield and Lava Latte; Espresso Pipes; Latte Art's four
   pours. Then one review, the checks (`npm run verify`, the Chromium 91
   smoke, a sweep of every screensaver over ten screen sizes), into `main`,
   and the owner's look on the iPad.
