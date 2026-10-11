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
- A key pasted into the chat, a bag's details or a typed answer is taken out
  before the coach, the transcript or Decaid see it, and exported or backed-up
  text replaces anything shaped like a key with `[redacted]`.
- **Keep my API key in Decaid** (Settings, off by default) also keeps a copy
  in Decaid's key-value store, in a namespace of its own (`cafai-key`).
  Decaid's store has no sign-in: any device on your network can read it, and
  Decaid's backups include it. Turning the switch off, or **Forget key**,
  deletes the copy. Leave it off on a network you do not trust.

**CafAI Bridge** (`bridge/`, Claude on your own computer)

- It listens on your network over plain HTTP. Every route except `/health`
  needs the bridge's 8-character pairing code; five wrong codes from one
  address in ten minutes lock that address out for a minute, doubling up to
  fifteen. The code is kept on the device like the API key (never in Decaid
  or an export) and never written to the bridge's log.
- Its MCP endpoint answers only `127.0.0.1`, and it can be stopped over HTTP
  only from its own computer.
- It never reads, stores or forwards your Claude sign-in. Coach runs use none
  of your Claude Code settings, hooks, plugins, skills, CLAUDE.md files or
  built-in tools, and its log holds times, sizes and model names, never what
  you or the coach wrote.
- Run it only on a network you trust: anyone who can watch that network can
  read the code on its way to the bridge.

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
