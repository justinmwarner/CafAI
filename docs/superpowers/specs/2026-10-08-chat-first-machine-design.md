# Chat first, the machine on demand: design

Date: 2026-10-08. Status: approved (the owner chose "build it as drawn").
Mockup: [2026-10-08-chat-first-machine.mockup.html](2026-10-08-chat-first-machine.mockup.html),
rendered in `assets/chat-first-*.png`. Builds on the UX rework
([2026-10-07-ux-modes-and-theme-design.md](2026-10-07-ux-modes-and-theme-design.md))
on the same branch, `feat/ux-modes-theme`.

## 1. The owner's ask

"When I load the page, I expect the graph and the whole machine stats to not
show up. The chat window could have a 'stats' message it sends when you
first open it that live updates, but then as you chat, it goes away. Then in
the pre-filled prompts, one can always be stats to output it again. Then the
graph you have to click into, it can be in the header." And: "We can still
have a row of these really commonly used buttons, even the stop button can
live up here and it replaces whatever the active thing is."

Answers given: the stats card is removed once the chat moves on; the phone
follows the same idea (its Machine tab becomes Shot); the only pre-filled
prompt is Stats; Stop lives only in the machine row (no second Stop).

## 2. What changes

- **No machine column.** On a tablet the routed screen takes the whole width
  under the top bar. The column's preview chart goes with it.
- **The machine row** sits in the top bar on every screen, between the places
  (Coach, Shot, History, Settings) and Decaid's buttons: Espresso, Steam,
  Flush, Hot water. On a tablet each button has its icon over a short label;
  on a phone, icons only (with accessible names).
- **The stats card** is a live card at the end of the chat: connection
  (machine, scale), the state line, Group (with its target), Steam, Water
  (Refill when low), Scale, the loaded profile (this bag's version or not),
  Tare and Sleep/Wake. It reuses the column's readouts and their rules.
- **The Stats prompt**: one chip above the composer, "Stats", always there.
- **The graph** opens from Shot (the tablet's top bar, the phone's tab). The
  phone's Machine tab is renamed Shot and shows the Shot view.
- **Problems** the column used to show (not connected, a connection error,
  water to refill) show as one slim alert under the top bar, only while the
  problem lasts. The coach's banner for a profile loaded behind CafAI's back
  (with Retry) stays where it is, in the coach screen.

## 3. The rules

| Thing | Rule |
|---|---|
| Machine row, idle | Espresso, Steam, Flush, Hot water, each enabled as the column's start buttons are today (connected, awake, not busy). |
| Machine row, something running | The running one turns into Stop, in its own place, filled in the error colour; the other three are disabled. Stop sends the same stop as today's Stop button. Its place and size never change, so the finger finds it. |
| Machine row, group-head machine | Starts happen on the group head (today's rule: the controls model's `startsVisible`): the row is empty until something runs, then shows Stop alone. |
| Machine row, asleep | The row shows Wake alone. |
| Machine row, not connected | The buttons are disabled; the alert says why. |
| Stats card, when | Posted when the app opens, and each time Stats is tapped. One at a time: tapping Stats while one shows moves it to the end of the chat. |
| Stats card, goes away | As soon as anything new lands in the chat after it: your message, a coach message, a notice, a shot card. Switching bags takes it away too. |
| Stats card, what it is | Screen-only state for this session: never saved, not in History or the export, never sent to the coach. A reload starts with it shown again. |
| Stats prompt | Above the composer on every chat, tablet and phone. A tap posts the card; no bubble, no coach call. |
| The graph | Shot opens the Shot view at full width: the last shot between shots, a dash before any shot. A starting shot still takes the screen by itself and hands back to the coach once the shot's card is in the chat (D85, unchanged); the coach's note stays (D86). |
| Tap guard | Still 350 ms on a screen that appeared by itself, covering the main pane only. The top bar, with the machine row and Stop, is never covered, on a tablet or a phone. |
| Phone | Tabs Coach, Shot, History, Settings. The live strip on the Coach tab during a shot stays and opens the graph. The Shot view is the same component as the tablet's, narrowed. |

## 4. Units

- `src/ui/machine/MachineRow.tsx`: `MachineRow({ icons?: boolean })`. The row
  and its states; the start, stop and wake logic comes from the column's
  controls (commands.ts and the controls model), not a copy.
- `src/ui/machine/StatsCard.tsx`: `StatsCard()`. The live card, laid out for
  its own width (four readouts in a row when there is room, two by two
  otherwise).
- `src/ui/machine/MachineAlerts.tsx`: `MachineAlerts()`. The slim alert, or
  nothing.
- `src/ui/machine/ShotView.tsx`: full width on a tablet, narrow on a phone.
- The stats card's state (shown or not, after which message) lives with the
  chat (`src/ui/chat/`), per services instance like the shot recording, so
  it survives a visit to History and back.
- `src/ui/shell/AppShell.tsx`: the top bar gains the row (both layouts) and
  the alert under it; the column and `MachinePanel` go; the phone's tab
  becomes Shot.

## 5. What goes

The machine column, its preview chart, `MachinePanel` (and with it D87's
short-phone cover rule and the split two-column panel on a phone's side),
the phone's Machine tab name, and the column's own Stop and start buttons.
The readouts, the state line and the controls' logic live on in the card and
the row.

## 6. Testing

Unit tests for the row's states, the card's life (shown on open, gone after
a new message or a bag switch, back on Stats, never stored), the alert, and
the shell (no column, the row in both top bars, the Shot tab). The e2e suite
and the Chromium 91 loop follow the new places (Espresso in the top bar, the
machine readings in the stats card, the Shot tab), on all five projects. A
fresh-eyes check after.

## 7. Decisions to record

D90 the machine column goes; the machine row; Stop in the running button's
place. D91 the stats card and the Stats prompt. D92 the graph from Shot; the
phone's Machine tab becomes Shot; the tap guard never covers the top bar.
