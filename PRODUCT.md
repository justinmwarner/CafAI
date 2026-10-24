# Product

## Register

product

## Users

Home baristas with a Decent DE1 espresso machine, dialing in a new bag of
coffee. They stand at the machine, in morning daylight or evening lamplight,
and glance at the Decent tablet mounted on it (or a phone propped beside it)
from a step back, often with wet hands and a cup in the other hand. A dial-in
is a short loop repeated a few times per bag: describe the coffee, pull a
shot and watch it for 30 to 60 seconds, taste it, tell the coach how it
tasted, confirm one change.

## Product Purpose

CafAI is a chat-first AI dial-in coach skin for Decaid, the Decent Espresso
app, and a complete everyday skin around it (machine status, espresso,
steam, flush, hot water, sleep, tare and a live shot graph). The coach
suggests a starting profile, reads every shot, and changes one thing at a
time, only when the barista confirms. Success: a cup the barista enjoys in
fewer shots, every change understood before it reaches the machine, and
never a screen without a way back to Decaid.

## Brand Personality

Calm, precise, warm. It feels like a good espresso scale or a well-made
grinder: quiet until it matters. The coach speaks plainly and gives numbers
the barista can act on. Decent's own shot graphs (pressure green, flow blue)
are the visual reference for anything that plots a shot.

## Anti-references

- A SaaS dashboard: metric tiles, sidebars full of charts, enterprise chrome.
- Glassy gradients, glassmorphism and glow for decoration.
- A cartoon coffee shop: mascots, latte-art clip art, novelty fonts. (The
  steam dial's Rosetta, a scene the barista picks, draws its leaves from
  the steam's time: a reading, not clip art.)

The one place for play is the screensaver (D226), shown only while the
machine sleeps and nobody is there: classic screensavers (the bouncing DVD
logo, the 3D pipes, Starfield, the lava lamp, the falling code) redrawn in
code with coffee, and latte art poured in a cup, always dark and dimmed, and
lit like a still life rather than drawn flat (D249). Still never clip
art, mascots or novelty fonts. Like
the drinks' dial while a drink runs, it moves for as long as it shows, and it
is the one place whose motion may bounce.

## Design Principles

1. **The shot comes first.** While a shot runs, the graph and Stop own the
   screen, and nothing moves under a thumb.
2. **Read from a step back.** Big tabular numbers, high contrast, 48 px
   touch targets, nothing that needs a squint.
3. **Quiet until it matters.** Restrained color; the accent marks actions and
   state, never decoration. The coach speaks when it has something to say.
4. **Every change is the barista's.** Show the change in plain words and wait
   for a tap before anything reaches the machine.
5. **Always a way out.** Exit and Decaid settings on every screen, in every
   layout.

## Accessibility & Inclusion

- WCAG 2.2 AA contrast in every tint and in both light and dark, enforced by
  tests rather than checked by eye.
- 48 px minimum touch targets (wet thumbs, not a mouse).
- Reduced motion respected: every animation has a still alternative.
- Color is never the only signal: graph series carry labels and values,
  states are written in words.
- A visible focus ring for keyboard use; touch users never see it.
