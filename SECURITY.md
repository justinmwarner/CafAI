# Security policy

## Report a vulnerability privately

Use GitHub's private vulnerability reporting: open this repository's
**Security** tab and choose **Report a vulnerability**. Please do not open a
public issue or pull request for a security problem, and never paste a real
API key, the bridge's pairing code or anything else secret into a report:
describe it, or use a placeholder such as `sk-ant-test`.

A useful report says:

- what you found and what someone could do with it;
- how to reproduce it;
- the CafAI version (Settings > About) and the Decaid version (the same
  screen), and the device: a Decent tablet, a phone's browser, or a computer;
- for CafAI Bridge, the computer's operating system and `npm run bridge --
  status`.

You will get an answer as soon as possible. CafAI is a small project run in
spare time, so a fix can take a while; you will hear what is planned, and be
credited in the release notes unless you would rather not be.

## Supported versions

Fixes go into the next release. Only the latest release is supported (0.1.0
is the first).

## What CafAI does with secrets

**The Anthropic API key**

- It is stored only on the device you enter it on, in that browser's
  IndexedDB, in a database of its own (`cafai-secrets`), apart from CafAI's
  other data (`src/storage/secrets.ts`). An export, an import and CafAI's
  backup to Decaid never open that database.
- It leaves the device only as the `x-api-key` header of requests that go
  straight from the browser to `https://api.anthropic.com`
  (`src/llm/anthropic.ts`).
- It is never logged. CafAI never writes the key, prompts or tokens to the
  browser console or to Decaid's store, because Decaid serves a skin's
  console to anyone on the network (`/api/v1/webview/logs`). Storage errors
  are fixed sentences, so a key cannot ride along in one.
- Settings > Log, which shows what CafAI sends to and gets from Decaid and
  the coach, never holds it. Everything is redacted on the way in
  (`src/traffic/redact.ts`): the `x-api-key` header (and any other header
  with a key, token, secret, password, auth, cookie or session part in
  its name) is kept by name only, and its value is taken out of the rest
  of that exchange too, headers included; the key and the bridge's code
  CafAI last used are looked for in everything, a chat that quotes one
  included; anything shaped like a key becomes `[key redacted]` in any
  body, URL or header; a coach reply whose stream events, put together,
  hold a secret keeps none of them; and no body said to or by the key's
  copy in Decaid is kept. The log lives in the page's memory only and
  leaves the device only when you tap Share, Email or Copy; it does hold
  what you and the coach wrote.
- A key pasted into the chat, a bag's details or a typed answer is taken out
  before the coach, the transcript or Decaid see it, and exported or backed-up
  text replaces anything shaped like a key with `[redacted]`.
- **Keep my API key in Decaid** (Settings, off by default) also keeps a copy
  in Decaid's key-value store, in a namespace of its own (`cafai-key`).
  Decaid's store has no sign-in: any device on your network can read it, and
  Decaid's backups include it. Turning the switch off, or **Forget key**,
  deletes the copy. Leave it off on a network you do not trust.

**Your data in Decaid**

- CafAI backs up bags, versions, shot summaries, feedback, each bag's chat
  and the settings to Decaid's key-value store (namespace `cafai`), so they
  survive a Decaid update. Like everything in Decaid's store, any device on
  your network can read it. It never holds the API key or the bridge's code.

**CafAI Bridge** (`bridge/`, Claude on your own computer)

- It listens on your network over plain HTTP. Every route except `/health`
  needs the bridge's 8-character pairing code; five wrong codes from one
  address in ten minutes lock that address out for a minute, doubling up to
  fifteen. The code is kept on the device like the API key (never in Decaid
  or an export), never in Settings > Log (redacted like the key, also when
  the bridge echoes it back as ABCD-EFGH) and never written to the bridge's
  log.
- Its MCP endpoint answers only `127.0.0.1`, and it can be stopped over HTTP
  only from its own computer.
- It never reads, stores or forwards your Claude credentials (it asks Claude
  Code only whether you are signed in, and with which plan). Coach runs use
  none of your Claude Code settings, hooks, plugins, skills, CLAUDE.md files
  or built-in tools, except WebSearch while CafAI's Fun facts includes a web
  search (D203): it searches the web and nothing else, with no file, shell or
  fetch access. Its log holds times, message counts, durations, model
  names and its own events (the address of a device that sent a wrong code,
  Claude Code's version and error output), never what you or the coach
  wrote and never the code.
- Run it only on a network you trust: anyone who can watch that network can
  read the code on its way to the bridge.

**Usage sharing** (Microsoft Clarity, in CafAI's releases only)

- Release builds send Microsoft Clarity how CafAI is used, under its
  developer's own Clarity project: the screens that open, taps and scrolls,
  eleven coach steps and five tags (`src/usage/`); where the device's time
  zone or language points to Europe, only after **Yes, share** (the README's
  Privacy section says what and where). Clarity sees the page's layout,
  where it was tapped and the page's address: the screen's name
  (`?screen=history-bag`) and CafAI's route, which in a bag's History view
  holds that bag's random id (`#/history/<id>`, naming no coffee and no
  person). The project is set to Strict masking, which replaces every word
  before upload. No tag holds anything a person typed, and nothing ties a
  session to a person: CafAI makes no `identify` call.
- Clarity records every link's address on the page, masked or not. While the
  device shares, **On Visualizer**, whose address leads to the barista's shot,
  is a button that goes there on a tap instead, so the address is never on
  the page; CafAI's other links lead to its own screens, the care videos,
  the README and Decaid's settings.
- The chat's root (its transcript, every card, the prompt row and the
  composer's lane) and Settings > Log carry `data-clarity-mask="true"`,
  which hides their text and images, children included, even if the
  project's setting were changed (`src/usage/mask.ts`).
- Clarity ignores that attribute on a form field: it replaces a field's
  value, and sends a short hash of it when it changes. It drops a field
  entirely, no value and no hash, only when one of the field's attribute
  values holds a word such as "secret". So the API key field, the bridge's
  pairing code field and the composer carry `data-private="secret"` in every
  state, **Show** included. While the device shares, CafAI gives every other
  form field the same attribute as it appears (`src/usage/fields.ts`), since
  a short value such as a TDS or a grind setting is easy to find again from
  a hash. No field's value, nor a hash of it, goes to Clarity.
- Decaid puts its Decent-account proxy token into the page as
  `<meta name="reaprime-proxy-token">`. Clarity never records `<meta>`
  elements, nor script variables such as `window.__REA_PROXY_TOKEN__`, so
  the token is in no upload. CafAI itself never reads it.
- So the key still leaves the device only as the `x-api-key` header to
  `https://api.anthropic.com`, and the code only for the bridge. Before a
  release carries a Clarity project, a test run checks the uploads for both
  fields (D216).
- Clarity's script comes from `https://www.clarity.ms/tag/<id>`, once the
  app has rendered. A load that fails or is blocked logs nothing, because
  Decaid serves a skin's console to the network. Turning sharing off in
  Settings > About (or **Turn off**, **No thanks**) stops Clarity first, then
  erases its cookies itself and takes the screen out of the address, so
  nothing more is sent from that page. It never calls Clarity's
  `consent(false)`, which would start Clarity again without cookies. A
  Clarity script that had not run yet starts nothing. CafAI has no
  Content-Security-Policy; one added later must allow `https://*.clarity.ms`
  and `https://c.bing.com`.

## Outside CafAI

Decaid's own API (port 8080) has no sign-in and open CORS: anything on your
network can talk to the machine through it. That is how Decaid is built, and
CafAI cannot change it. Report problems in Decaid to Decent Espresso at
<https://github.com/decentespresso/decaid>, and problems in Claude Code to
Anthropic.

## For contributors

Never commit a real API key, token, pairing code or a Decaid backup. Tests
use placeholders (`sk-ant-test`, `sk-ant-demo`), `npm test` never calls the
Anthropic API, and the opt-in live test reads `ANTHROPIC_API_KEY` from the
environment only. See [CONTRIBUTING.md](CONTRIBUTING.md).
