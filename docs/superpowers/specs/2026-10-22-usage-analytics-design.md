# Usage analytics with Microsoft Clarity: design

Date: 2026-10-22. Status: approved by the owner (2026-10-22). It covers:

- Microsoft Clarity under CafAI's own project, in release builds only.
- Asked first where the device's time zone or language points to Europe.
- On by default elsewhere, with a one-time notice.
- A switch in Settings > About on every device.
- A test run on the simulator and the owner's tablet before it ships.

Decisions D-USAGE-1 to D-USAGE-7, numbered after the merge
(`.verify/renumber-decisions.mjs`).

## 1. The ask

From the owner: "How can we add on analytics to track how many people are
using it? Can we use Microsoft Clarity at all so we can see how many people
actually use the coaching? how they use the app? heatmap / funnels, etc."
Offered three choices (ask first, on by default, or only the owner's devices),
the owner asked: "Is there a way we can determine if it's EU/UK/Swiss? Then in
that case ask first, but on everywhere else by default?"

Today's only signal is GitHub's download counts. Decaid downloads the release
zip once per install or update, so the counts are a floor on installs: 3 for
v0.1.0, 2 for v0.1.1 and 1 for v0.1.2 (2026-10-22). Nothing says who uses the
coach.

## 2. What changes

- **Usage sharing (D-USAGE-1).** Release builds send Microsoft Clarity how
  CafAI is used: the screens that open, taps and scrolls, and a short list of
  coach steps. Every word is hidden. Clarity gives the owner people and
  sessions, heatmaps, funnels and replays, free.
- **Where CafAI asks first (D-USAGE-2).** A European time zone or language,
  or no usable time zone, means ask first. Everywhere else sharing is on, with
  a notice.
- **The card, the notice and the switch (D-USAGE-3).** One card asks or tells
  once. A switch in Settings > About changes the choice on any device. The
  choice stays on the device.
- **Screens, events and tags (D-USAGE-4).** The screen is mirrored into the
  address so heatmaps split by screen. Eleven coach events serve as funnel
  steps, and five tags allow filtering.
- **What stays hidden (D-USAGE-5).** Strict masking. The chat and the log
  are marked as well, and the key, the code and the composer are kept out of
  Clarity entirely. Nothing identifies a person.
- **Loading (D-USAGE-6).** Clarity loads after the app starts, and its
  failures are silent. It never loads in dev, tests, the demo, plain mock
  mode or a fork.
- **The test run (D-USAGE-7).** The test run on the simulator and the owner's
  tablet comes before the first release that carries it.

## 3. Where CafAI asks first (D-USAGE-2)

Since 2025-10-31 Clarity enforces a consent signal for visitors in the EEA,
the UK and Switzerland. Without one it sets no cookies and counts each page
view as a new person and a new session, so a funnel shows nobody finishing.
CafAI decides on the device, from what the device already says, and asks
whenever it is unsure. Asking someone who did not need asking costs one tap.

| Signal | Ask first when |
|---|---|
| Time zone (`Intl.DateTimeFormat().resolvedOptions().timeZone`) | Any `Europe/*` zone, plus the zones outside that prefix listed below. |
| No usable time zone | Missing, `UTC`, `GMT`, `Etc/*`, or a check that throws. |
| Language (`navigator.languages`) | Any entry whose region is an EEA country, `GB` or `CH`, or Gibraltar (`GI`), the Isle of Man (`IM`), Jersey (`JE`) or Guernsey (`GG`). |
| Anything else | On by default, with the notice. |

The European zones outside `Europe/*`:

- Cyprus: `Asia/Nicosia`, `Asia/Famagusta`.
- The Atlantic islands: `Atlantic/Canary`, `Atlantic/Madeira`,
  `Atlantic/Azores`, `Atlantic/Reykjavik`, `Atlantic/Faroe`.
- `Africa/Ceuta` and `Arctic/Longyearbyen`.
- France's overseas regions: `America/Cayenne`, `America/Guadeloupe`,
  `America/Martinique`, `America/Marigot`, `Indian/Reunion`, `Indian/Mayotte`.

Notes on the rule:

- **Wrong time zone.** A tablet left on another time zone is still covered.
  Outside the ask-first case CafAI never claims consent (section 4), so
  Clarity's own check of the upload's address still keeps cookies off for a
  European household.
- **Not yet chosen.** While nobody has chosen on the device, the rule runs
  again at every start. A device that moves into an ask-first zone before
  answering gets the card instead of the notice. Once someone has answered,
  the answer stands.
- **Other countries.** The rule and its lists live in one module with its
  tests, and adding a country is one line. Other places that lean toward
  asking first (South Korea, China, Brazil) are left out, because the owner
  asked for the EU, the UK and Switzerland.

## 4. The card, the notice and the switch (D-USAGE-3)

The choice is kept per device under `cafai.usage.choice` in the device's own
storage: `{ choice: 'yes' | 'no', at, wording, rule: 'ask' | 'notice' }`. Like
the told fun facts (D200), it is never mirrored to Decaid and never exported.
A phone that opens CafAI decides for itself.

| Rule | Nobody chose yet | Yes / OK | No thanks / Turn off |
|---|---|---|---|
| Ask first | The card. Nothing from Clarity loads. | Clarity loads; `consentv2` with analytics granted and ads denied. | Nothing loads. |
| Notice | Clarity loads, with the notice; `consentv2` with ads denied only. | As before; the notice goes. | Clarity stops (below). |

**Where the card and the notice show.** Each is a quiet card at the foot of
the coach's chat, above the composer. Before there is a chat (no key, no bag
yet), it sits under the coach screen's panel instead, so Europe is asked
before the coach is set up. It belongs to the device, not to the bag, and
never enters a transcript, the backup or an export. It first shows while no
coach turn or shot runs, then stays put until answered, so nothing moves
under a thumb. Nothing waits on it.

**The card (ask first):**

- "Help improve CafAI?"
- "Share how you use CafAI with its developer through Microsoft Clarity: the
  screens you open, where you tap and scroll, and steps such as a shot read
  or a change confirmed. All text is hidden: never your words, your coffee or
  your key. Settings > About turns it off."
- **Yes, share** and **No thanks**, and a "What is shared" link to the
  README's Privacy section. Inside Decaid the link opens the system browser.

**The notice (elsewhere):**

- "CafAI shares how you use it with its developer through Microsoft Clarity:
  screens, taps and steps such as a shot read, with all text hidden. Settings
  > About turns it off."
- **OK** and **Turn off**, and the same link.

**The switch.** Settings > About, after the versions: **Share usage with
CafAI's developer**, with the line "Screens, taps and coach steps go to
Microsoft Clarity, with all text hidden." It is on every device, under either
rule. It reads on for a yes, or for nobody-chose under the notice rule, and
off otherwise. Changing it records a choice.

**The calls to Clarity:**

- **Ask first, yes:** `consentv2({ analytics_Storage: 'granted', ad_Storage:
  'denied' })`.
- **Notice:** `consentv2({ ad_Storage: 'denied' })` only. CafAI never claims
  analytics consent it did not ask for.
  - If the test run shows Clarity cannot keep ads off without that claim,
    CafAI makes no consent call under the notice rule.
  - Either way, the README says what Clarity's terms require it to say:
    Microsoft may use the data, including for advertising.
- **Off:** `stop` first, then CafAI erases Clarity's cookies (`_clck`,
  `_clsk`) itself and drops the screen parameter, and sends no more events.
  It never calls `consent(false)`, which starts Clarity again without
  cookies. The order follows clarity-js (`core/history.ts`, `queue.ts`,
  read in review, 2026-10-22):
  - while Clarity runs, a change of the address stops and restarts it, and
    calls made meanwhile wait for the restart;
  - a Clarity whose script has not run yet has its waiting calls dropped for
    a lone `stop`, and its queue marked as another tag's ("CL001"), so the
    script starts nothing.
  - If the test run shows uploads still go out, CafAI reloads the page the
    next time no shot or coach turn is running.

## 5. Screens, events and tags (D-USAGE-4)

**Screens.** CafAI routes by hash (`src/ui/router.ts`), and Clarity ignores
hash-only changes. While sharing is on, CafAI keeps `screen=<name>` in the
query beside the hash, using `history.replaceState`. Every other parameter
stays as it was (Decaid's `?_=<ms>`, the mock flags). Clarity starts a new
page view on that change, so each screen gets its own heatmap: filter "URL
contains `screen=settings`", whatever the device's host and port.

- The names: `coach`, `shot`, `history`, `history-bag` (never the bag's id),
  `settings`, `care`, `steam`, `hot-water` and `flush`.
- The router ignores the query, so a reload in a LAN browser behaves as
  before.

**Events** (`clarity('event', name)`). There are eleven, under Clarity's limit
of 20 custom events usable as funnel steps:

| Event | When |
|---|---|
| `coach_setup` | A key is saved, or the Bridge is paired, on this device. |
| `coach_message` | The barista starts a coach turn: a typed message or a tapped choice. |
| `bag_started` | A new bag's details are saved: from the library, a photo or words. |
| `profile_loaded` | A version is loaded on the machine: v1, a confirmed version, an undo, a bag switch, Retry, or a load that waited for the machine. |
| `shot_read` | A shot is read into the bag's dial-in. |
| `taste_given` | A taste answer is sent. |
| `change_confirmed` | A proposed change is confirmed. |
| `change_undone` | Undo. |
| `recipe_kept` | The barista keeps a recipe. |
| `fun_fact_shown` | A fun fact is shown (D197). |
| `coach_error` | A coach turn ends in an error the chat shows. |

The funnel the owner asked for: `coach_setup` → `bag_started` →
`profile_loaded` → `shot_read` → `taste_given` → `change_confirmed` →
`recipe_kept`. Clarity's funnels count sessions, not people.

**Tags** (`clarity('set', key, value)`). They are set once a page, and again
when one changes:

| Tag | Values |
|---|---|
| `cafai_version` | The app's version, e.g. `0.1.3`. |
| `coach_source` | `api-key`, `bridge` or `none`. |
| `host` | Decaid's platform from `__DECENT_HOST__` (`android`, `windows`, `macos`, `ios`), or `browser`. |
| `layout` | `tablet` or `phone`. |
| `rule` | `ask` or `notice`. |

The `host` tag stands in for Clarity's own device report. The WebView calls
itself only "Decent", so that report says nothing.

**No `identify`.** Clarity's cookie counts people, and nothing ties a session
to a person. Over plain http on a LAN address, the hash that `identify` needs
is not available anyway.

## 6. What stays hidden (D-USAGE-5)

- **Strict masking.** The Clarity project is set to Strict. Every word on the
  page is replaced before upload, in recordings and heatmaps alike. Inputs are
  masked in every mode.
- **Marked as well.** The chat's root (its transcript, every card, the prompt
  row and the composer's lane) and Settings > Log carry
  `data-clarity-mask="true"`. That hides their text and images, children
  included, even if the project's setting is ever changed.
- **Form fields.** Clarity ignores `data-clarity-mask` on a form field (an
  input, select or textarea). It replaces a field's value, then sends a short
  hash of it when it changes. It drops a field entirely (no value, no hash)
  only when one of the field's attribute values holds a word on its list:
  "password", "secret", "pass", "social", "ssn", "code" or "hidden"
  (clarity-js `MaskExcludeList`, read 2026-10-22). It decides when the field
  first appears.
  - The API key and the pairing code become plain text when **Show** is
    tapped, so both carry `data-private="secret"` in either state.
  - So does the composer: "never your words" means not even a hash of them.
  - While the device shares, every other field gets the same attribute
    (`src/usage/fields.ts`): the fields on the page at once, and each one
    added later. An observer made before Clarity's own does it, so it runs
    first on every change. A short value (a TDS, a grind setting, a bag's
    name) is easy to find again from a hash.
  - SECURITY.md promises the key leaves only for `api.anthropic.com`. The
    test run checks that nothing about these fields leaves the device.
- **Decaid's account token.** Clarity never records `<meta>` elements (as
  clarity-js reads, 2026-10-22), so the `reaprime-proxy-token` meta stays on
  the device. `window.__REA_PROXY_TOKEN__` is a script variable, and Clarity
  does not read those.
- **Tags.** No tag holds anything a person typed.
- **Replays from `localhost`.** Clarity's player loads a `<link>`'s
  stylesheet from the page's address, and only the tablet can reach
  `localhost`. MUI's styles are recorded anyway, because Clarity reads
  Emotion's rules from the page. CafAI's own stylesheet (2.8 KB) holds only
  the fonts' `@font-face` rules and the graph library's, and inlining it
  would not bring the fonts. So replays go without it: fonts fall back, and
  the shot graph, a canvas, shows blank.

## 7. Loading (D-USAGE-6)

- **The project ID.** It comes from `VITE_CLARITY_PROJECT_ID` at build time,
  set from a GitHub Actions variable in `release.yml` only. Only a production
  build reads it, never dev or `npm test`, whatever the shell holds. Without
  it (any fork's build included) CafAI loads nothing and shows no card,
  notice or switch.
- **Mock mode.** It reports to a stand-in project only when the e2e asks
  with `?mockUsage=1`, and the e2e routes Clarity's hosts to a stub. The demo
  never does.
- **The loader.** CafAI's own loader (Clarity's queue stub and one async
  script tag, `https://www.clarity.ms/tag/<id>`), with no new dependency.
  - It runs after the app has rendered, never before.
  - A load that fails or is blocked changes nothing on screen and logs
    nothing, because Decaid serves the console to the network.
- **CSP.** CafAI has no Content-Security-Policy today. If one is added,
  Clarity needs `https://*.clarity.ms` and `https://c.bing.com`.
- **Long-lived pages.** Clarity stops recording a page after about 2 h, 128
  uploads or 10 MB, until the next reload. Decaid reloads the skin when it
  comes back from the background. Together these bound what a tablet left on
  all day uploads.

## 8. Docs

- **DECISIONS:** D-USAGE-1 to D-USAGE-7 in a "Usage analytics (2026-10-22)"
  section.
- **README:**
  - Privacy: what goes to Microsoft Clarity, what is hidden, the region rule,
    that Microsoft may use the data including for advertising, a link to
    Microsoft's privacy statement, and how to turn it off.
  - Settings: the switch.
  - First run: the card or the notice.
- **SECURITY.md:** Clarity, the masking, the secret fields and the account
  token.
- **DESIGN.md:** the card, the notice and the About row.
- **CHANGELOG:** under Unreleased.
- **QUESTIONS.md:** whatever the test run leaves open.

## 9. Tests

**Unit (Vitest):**

- **The region rule:** every listed zone, a sample of others, `UTC`, `Etc/*`,
  a missing zone, languages with and without a region, and an `Intl` that
  throws.
- **The choice:** kept on the device only (never in settings, the mirror or
  an export), its states and moves, and the rule running again while unset.
- **The loader:**
  - Loads nothing without an ID, in mock mode or the demo, or for an unset
    ask-first device.
  - The script and each `consentv2` call per section 4.
  - On off, `stop` before the address changes, the cookies erased, and
    never `consent(false)`.
  - No event or tag while off.
- **Screens:** `replaceState` keeps every other parameter, the parameter
  goes on off, and `history-bag` never holds an id.
- **Events:** each one fires from its place, against a fake Clarity.
- **Masking:** the attributes are on the chat, the composer, the cards, the
  log and both secret fields.

**E2E (Playwright).** The mock build with `?mockUsage=1`, with
`*.clarity.ms` routed to a stub that records every call:

- `timezoneId: 'Europe/Berlin'`: the card shows, and nothing is requested
  from Clarity before **Yes, share**. After it, the tag is requested and a
  screen change carries `?screen=`.
- `timezoneId: 'America/Chicago'`: the notice shows and the tag is requested.
  After **Turn off**, no request follows.
- The demo, and mock mode without the switch, never request Clarity.
- `npm run smoke:chrome91` still passes. Its build has no project, and the
  lint rules hold the new code to Chromium 91.

## 10. The test run first (D-USAGE-7)

It needs the owner's Clarity project (clarity.microsoft.com, a Microsoft
account), with Strict masking set in its settings. Any site URL will do. With
its ID in a local release build:

1. **Data arrives.** In the Decaid simulator on Windows and in Chrome on
   `localhost`, sessions and the coach events appear in Clarity's live view.
   The "Decent" user agent is not dropped as a bot.
2. **Replays.** A replay looks like CafAI.
3. **Heatmaps.** `?screen=` gives one heatmap per screen.
4. **Cost.** A shot on the simulated machine, with and without Clarity: the
   CPU and the upload size.
5. **Secrets.** Nothing about the key or code fields appears in the uploads.
6. **Consent calls.**
   - `consentv2` with only `ad_Storage: 'denied'` leaves analytics at
     Clarity's default.
   - Turn off's `stop` ends the uploads, and nothing follows it: no restart,
     and a tag that had not loaded starts nothing.
   - Turned on again in the same page, `start` resumes them.
7. **The tablet.** The owner installs that zip on the tablet (Skins > + >
   ZIP file) for a day of ordinary use. Check for crashes (an open Clarity
   issue reports Android WebView crashes) and lag on the shot screen.

If the run fails:

- **At 1 or 7,** Clarity is dropped. The region rule, the card, the switch
  and the events stay, and sending moves to PostHog or a small counter of
  CafAI's own, in a new decision.
- **At 4,** Clarity stops while a shot runs and starts again after, if its
  API allows. Otherwise, as at 1.

## 11. Not in this

- An identity or profile for anyone.
- A server of CafAI's own.
- The Bridge, which sends no usage.
- Clarity's numbers shown inside CafAI.
- Asking first beyond the EEA, the UK and Switzerland.
