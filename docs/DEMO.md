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
3. Shot one, rated **Much worse** than the last shot of Santos (D126), tasted
   "Sour / sharp". The coach looks at the pressure curve and proposes v2,
   1 °C hotter: confirmed and loaded.
4. Shot two, **Better** than the shot before: the pour never built pressure,
   so the coach asks what the puck looks like (Pinholes and Wet patches are
   picked) and proposes one step finer on the Niche Zero, 15 to 14.5, a
   change made by hand.
5. This morning, a shot that ran "D-Flow / default" (someone loaded another
   profile): CafAI says it is not part of the dial-in, and Retry loads
   Kiambu AA v2 again.
6. Shot three, **Better** again, answered with Other: "Sweeter, but a little
   thin". The coach proposes a slower pour (v3); it is declined (Not now),
   asked for again, loaded, and undone ("Back on Kiambu AA v2."). A middle
   way, v4 at 2.0 ml/s, is loaded and keeps its Undo.
7. Shot four, a few minutes ago, not rated ("Compared with your previous
   shot?" waits for a word), and the open question.

Every puck is its own, as at a real grinder, so no two shots share their
numbers. A shot's time is the pour (D78), and every other time on its card
counts from the start of the pour too (the mock's records begin with about
2 s of preheat). The cards show (the D-Flow shot gets a notice instead of a
card; its numbers are the ones a card would show):

| Shot | Time | First drops | Peak pressure | Yield |
|---|---|---|---|---|
| One, v1 at 15 | 60.0 s | 4.6 s | 6.0 bar at 59 s | 47.3 g: the profile ended short of its 50 g stop |
| Two, v2, the uneven puck | 59.8 s | 3.8 s | 4.1 bar at 4 s, in the fill | 49.5 g: the water ran through fast |
| D-Flow / default (not in the dial-in) | 35.4 s | 4.2 s | 4.6 bar at 21 s | 50.3 g: the scale stopped it at 50 g |
| Three, v2 at 14.5 | 60.8 s | 7.8 s | 6.8 bar at 60 s | 43.7 g: slower after the finer grind |
| Four, v4 at 14.5 | 60.6 s | 6.0 s | 5.4 bar at 60 s | 40.4 g: the profile ended short of its 50 g stop |
| Santos, its one shot | 21.8 s | 2.8 s | 7.2 bar at 2 s | 36.3 g: the scale stopped it at 36 g |

A yield is the cup once the last drips are in, as Decaid records it. The
mock stops at weight the way Decaid does, early by about a second of the
flow, so a shot the scale stopped settles within about 1 g of its stop. A
shot you pull now (the mock's default puck) runs about 60.4 s, first drops
at 5.4 s, 5.3 bar at 59 s, 41.4 g.

The bag picker also lists **Santos** (Brazil, natural, medium-dark): Gentle
and Sweet, one shot rated **Better** than the coffee usually enjoyed and
answered "Balanced, sweet". The coach proposes
keeping the recipe as it is (a keep card) and the barista confirms it, so
History says "Kept as is". Its shot card carries the channeling warning
("Pressure dipped after the peak"): Blooming Espresso pours with flow only,
so CafAI's channeling check has no pressure to judge on Kiambu AA's shots.
Picking Santos loads its v1 on the mock machine, as switching bags does.
History shows both bags with their versions and shots.

The machine is the mock's. Espresso in the top bar pulls a scripted shot of
v4 that takes about a minute, as a real one does: Blooming Espresso fills
the puck, soaks it for about 30 s with the pump off (the Shot view shows
0 bar then), and then pours. It adds a shot card and a new taste question
(and closes the open one). The stats card's group target follows the profile the mock machine
holds: idle, its first step (98.5 °C for v4, whose fill runs hotter than its
93 °C pour), and during a shot the step that runs (91 °C in v4's bloom), back
to the idle target once the shot is done.

Machine care is kept up (D-CARE-1): the weekly clean was done 8 days ago, so
it is due, and the stats card's last line says "Weekly clean due: 6 shots
since the last" (the dial-in's shots), opening the step on the Care screen.
The rest are on time there: Rinza 3 days ago, the tank and tray 2, the intake
filter 11 (due in 3 days), the group head's parts and the gasket 16, the
descale 140; the steam tip and the transport were never marked done.

## Answering the open question

The coach's replies come from the scripted coach (`mock/anthropic/`), in its
demo voice: about 1.5 s of "Thinking…", then text at reading pace. It always
looks at the pressure curve first (it quotes the peak as the shot card shows
it, counted from the start of the pour: "5.4 bar, 60 s in"), then proposes
one change:

| You answer | The coach proposes |
|---|---|
| Sour / sharp | **Kiambu AA v5**, 1 °C hotter (94 °C, the top of Blooming's range) |
| Bitter / harsh | Kiambu AA v5, 1 °C cooler |
| Weak / watery | One step finer on the grinder, by hand (14.5 to 14.0) |
| Balanced, sweet | "Keep everything as it is": confirming locks v4 in, no new version |
| Other, with your words | Read for the same words (sour, bitter, weak or watery, strong, balanced); "strong" is one step coarser on the grinder, by hand (14.5 to 15.0); anything else is one step finer (14.5 to 14.0) |

Weak and strong move the grinder because shot four ran out of steps at
40.4 g, short of its 50 g stop: a stop 2 g sooner or later would never be
reached, so the coach says so and grinds finer or coarser instead. After a
shot that reached its stop (the scale stopped it, or it ended within 1 g of
it) they move the stop: 2 g sooner for weak, 2 g later for strong. Strong
never grinds finer, which would make the cup stronger: when the stop cannot
go later, it is one step coarser.

Confirm saves the new version, shows "Loading Kiambu AA v5 on the machine…"
for about 1.5 s while the mock machine takes it, then "Loaded Kiambu AA v5 on
the machine.". Not now keeps v4; Undo goes back to v2. Typing in the chat
instead of tapping sets the question aside, and what you type is the shot's
taste (CafAI saves it as one, D79), read exactly as the same words under
Other: "It tasted a bit sour, sharp at the end" gets the same look at the
curve and the same v5 as tapping Sour / sharp, and "Flat and a bit dull, the
fruit is hiding", with no taste word, gets one step finer (14.5 to 14.0).
Text typed when no taste question is open (a change card is waiting, say)
gets the coach's usual short reply.

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
slim note across the top of the page says: "The demo did not load: this
address already has CafAI data of its own. Run npm run demo." (which opens
the demo's own address, localhost:5175). The note is one 34 px line and the
app moves down below it, so it covers nothing and the app keeps nearly its
whole height; Dismiss gives the app the whole page again.
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
transcript is one the API accepts, no two Kiambu AA shots share their time,
first drops or yield, the coach's turns quote a shot's times as its card
shows them, and the real engine opens it without a new message or banner and
answers each choice, typed or tapped.
