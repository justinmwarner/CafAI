# The demo: CafAI as it looks in use

The demo opens CafAI with a dial-in already under way: two bags, every kind
of card and notice the coach shows, and one open "How did it taste?" that
you can answer and watch the coach reply to. It runs entirely on the
built-in mocks: the mock Decaid (machine, scale, shots, profiles) and the
scripted coach. There is no Decaid to install, no API key and no spend.
(To try CafAI against Decaid's own simulator instead, see
[SIMULATOR.md](SIMULATOR.md).) The decision behind it is D76 in
`DECISIONS.md`.

## Start it

```powershell
npm ci
npm run demo
```

It opens <http://localhost:5175/?demo=1> in your browser. The demo has its
own port, so its browser storage never meets the bags and key you use with
`npm run dev` on port 5173. Another app already on port 5175 stops it with an
error; close that app and run it again.

## What is on screen

The coach screen, on the bag **Kiambu AA** (Kenya, washed, light roast) with
**Kiambu AA v4** loaded. Scroll up to read the dial-in from the start:

1. The new-bag intro, the barista's description, and the coach's reply with
   three starting profiles; **Blooming Espresso** is in use.
2. Where v1 stops (50 g for the 18 g dose) and "Loaded Kiambu AA v1 on the
   machine.".
3. Shot one (2 stars), tasted "Sour / sharp". The coach looks at the pressure
   curve and proposes v2, 1 °C hotter: confirmed and loaded.
4. Shot two (3 stars): the pour never built pressure, so the coach asks what
   the puck looks like (Pinholes and Wet patches are picked) and proposes one
   step finer on the Niche Zero, 15 to 14.5, a change made by hand.
5. This morning, a shot that ran "D-Flow / default" (someone loaded another
   profile): CafAI says it is not part of the dial-in, and Retry loads
   Kiambu AA v2 again.
6. Shot three (4 stars), answered with Other: "Sweeter, but a little thin".
   The coach proposes a slower pour (v3); it is declined (Not now), asked for
   again, loaded, and undone ("Back on Kiambu AA v2."). A middle way, v4 at
   2.0 ml/s, is loaded and keeps its Undo.
7. Shot four, a few minutes ago, not rated, and the open question.

The bag picker also lists **Santos** (Brazil, natural, medium-dark): Gentle
and Sweet, one 5-star shot answered "Balanced, sweet", kept as it is. Its
shot card carries the channeling warning ("Pressure dipped after the peak"):
Blooming Espresso pours with flow only, so CafAI's channeling check has no
pressure to judge on Kiambu AA's shots. Picking Santos loads its v1 on the
mock machine, as switching bags does. History shows both bags with their
versions and shots.

The machine panel is the mock's. Espresso pulls a scripted shot of v4, which
adds a shot card and a new taste question (and closes the open one).

## Answering the open question

The coach's replies come from the scripted coach (`mock/anthropic/`), in its
demo voice: about 1.5 s of "Thinking…", then text at reading pace. It always
looks at the pressure curve first, then proposes one change:

| You answer | The coach proposes |
|---|---|
| Sour / sharp | **Kiambu AA v5**, 1 °C hotter (94 °C, the top of Blooming's range) |
| Bitter / harsh | Kiambu AA v5, 1 °C cooler |
| Weak / watery | Kiambu AA v5, stopping 2 g sooner (48 g) |
| Balanced, sweet | "Keep everything as it is": confirming locks v4 in, no new version |
| Other, with your words | Read for the same words (sour, bitter, weak, balanced); "strong" stops 2 g later (52 g); anything else is one step finer on the grinder, by hand (14.5 to 14.0) |

Confirm saves the new version, shows "Loading Kiambu AA v5 on the machine…"
for about 1.5 s while the mock machine takes it, then "Loaded Kiambu AA v5 on
the machine.". Not now keeps v4; Undo goes back to v2. Typing in the chat
instead of tapping sets the question aside, and the coach answers the text.

## Starting over

Every load of a `?demo=1` page starts the same demo from the beginning: a
reload throws away whatever you did and puts the story back, timed from now
(the dial-in started about a day ago, the last shot a few minutes ago). It
always opens on the coach screen.

## It never replaces your own data

The demo writes only to an address with no CafAI data, or with data it wrote
itself: after a load it leaves a marker (`cafai-demo:seeded` in
localStorage). CafAI data is any bag, version, shot log or chat, saved
settings, or an API key other than the demo's placeholder `sk-ant-demo`.
Even under the marker, an API key the scripted coach does not know (a real
one) keeps the demo away: someone has used the address for real since.

Anywhere else the demo writes nothing, the normal mock app starts, and a
note says: "The demo did not load: this address already has CafAI data of
its own. Run npm run demo, which opens its own address (localhost:5175)."
`?demo=1` also works on `npm run dev:mock`, but only where that address has
no data of its own. With `?mockDecaid=0` the flag is ignored (the demo needs
the built-in mock Decaid), and the browser console says so.

## States a calm demo does not show

These switches already exist in mock mode; they work in the demo too.

- **The coach fails.** In Settings, save the key `sk-ant-overloaded`, then
  answer the open question: the banner says "Anthropic is overloaded right
  now. Try again in a minute." with Retry. The key `sk-ant-invalid` gives
  "Anthropic did not accept your API key. Check it in Settings.". A reload
  puts the demo key back.
- **A slow machine.** <http://localhost:5175/?demo=1&mockUploadMs=3000>: after
  Confirm, "Loading … on the machine…" stays for 3 s.
- **An older Decaid.** <http://localhost:5175/?demo=1&mockNoMachineProfile=1>:
  Decaid has no route to confirm a load, so CafAI trusts the workflow and
  reports the load at once, as it does on an older Decaid.
- **The machine drops.** In the browser console:
  `window.__CAFAI_MOCK__.state.setMachineConnected(false)`. The panel shows
  the machine disconnected, and a confirmed change says Decaid loads it when
  the machine connects. `window.__CAFAI_MOCK__.state.setMachineConnected(true)`
  brings it back, and CafAI confirms the load.

## How it is built

`mock/demo/` holds the story (`story.ts`: what the barista did and when, and
the coach's turns, written by hand), and plays it through CafAI's own coach
engine on in-memory storage and a mock Decaid of its own (`build.ts`). So
every card, notice, chat bubble and record is the one the app itself writes.
The result replaces CafAI's storage through its import (`seed.ts`) and goes
into the running mock Decaid; `guard.ts` decides whether it may. The unit
tests in `mock/demo/` check the story covers every kind of card, the
transcript is one the API accepts, and the real engine opens it without a
new message or banner and answers each choice.
