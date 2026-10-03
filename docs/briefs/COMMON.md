# Common rules for every CafAI workstream agent

CafAI (skin id `cafai`) is a chat-first AI espresso dial-in coach that runs as
a web "skin" inside Decaid, the Decent Espresso app. React 19 + TypeScript +
Vite + MUI 9 + `@mui/x-chat`. Six sub-agents build it in parallel; the
integrator owns the shared contracts, reviews your work, commits it, and
writes the coach engine that ties everything together.

Repo: `E:\source\cafai` (Windows; use the Bash tool with POSIX paths like
`/e/source/cafai`, or PowerShell). Node 24, npm.

## Read first (in this order)

1. Your own brief in `docs/briefs/`.
2. `docs/VERIFIED.md` and the detailed file(s) your brief names in
   `docs/verified/`. These are verified facts; they override
   `docs/RESEARCH.md` (background only).
3. The section of `docs/CREMA_PORT_PLAN.md` for your workstream.
4. `DECISIONS.md` (decisions already made; follow them).
5. The shared contracts (READ-ONLY for you):
   `src/api/types.ts`, `src/coach/types.ts`, `src/coach/contract.ts`,
   `src/llm/types.ts`, `src/storage/types.ts`, `src/app/types.ts`,
   `src/app/services.tsx`, `src/ui/testIds.ts`, `src/util/id.ts`,
   `src/util/clone.ts`, `src/ui/testing/fakeServices.ts`.
6. `docs/briefs/ENGINE_PROTOCOL.md` if your brief mentions it.

Reference clones (read-only, never modify): Crema at `crema/` (port from
`crema/web/` only), and `.ref/decaid`, `.ref/streamline-js`, `.ref/dye2`,
`.ref/decaid-zen`, `.ref/MSL`, `.ref/decaid-mcp`.

## Ownership

- Create or modify files ONLY under the paths your brief says you own.
  Everything else is read-only, including the shared contracts above.
- If a shared contract lacks something you need, define it locally in your
  module and list the proposed contract change in your final report. Do not
  edit shared files; another agent depends on them right now.
- Do not edit `package.json`, `package-lock.json`, `vite.config.ts`,
  `tsconfig.json`, `eslint.config.js`, `playwright.config.ts`, `index.html`
  or `src/main.tsx` (a temporary probe the integrator replaces).
- Do not add dependencies. Installed: react 19.3, @mui/material +
  @mui/icons-material 9.4, @mui/x-chat 9.0.0-alpha.18, @emotion, zod 4.6,
  idb 8, uplot 1.6, msw 2.15, vitest 5, @testing-library/react + user-event +
  jest-dom, fake-indexeddb, jsdom, @playwright/test. If something seems
  required, work around it and explain in your report.
- No git commands that change state (no add/commit/stash/checkout/reset).
  The integrator commits after review.

## Code rules

- TypeScript strict with `noUncheckedIndexedAccess`, `verbatimModuleSyntax`
  and `erasableSyntaxOnly` (no enums, namespaces or constructor parameter
  properties). Import local files WITH the extension (`./client.ts`,
  `./Panel.tsx`); use `import type` for types.
- Chromium 91 WebView (the floor of Decent's tablets). Never use
  `crypto.randomUUID` (use `newId()`), `structuredClone` (use `clone()`),
  `AbortSignal.timeout/any`, `signal.throwIfAborted()`, `for await` over a
  `ReadableStream` (use `getReader()`), static `Response.json()`, or
  `navigator.mediaDevices` / `getUserMedia` (no camera or mic in skins).
  Avoid CSS `:has()`, container queries, `color-mix()`, `dvh`/`svh`, `@layer`
  and native CSS nesting. ES APIs like `Array.prototype.at` are polyfilled.
  ESLint enforces most of this.
- No dynamic `import()` in app code: Decaid replaces skin files in place on
  update, so a lazily loaded chunk can 404 in a running page.
- Never log secrets (the API key) or per-frame telemetry: Decaid saves the
  WebView console and serves it over the LAN.
- Comments explain why, not what (see Crema's style). No filler.
- User-facing text: short plain sentences a barista can act on.

## Tests

- Tests sit next to the code: `foo.ts` + `foo.test.ts`. Vitest. Logic tests
  run in Node (the default). React/DOM tests start with the line
  `// @vitest-environment jsdom`.
- Use test-driven development for new logic: write the failing test first.
- Port Crema's tests together with the code they cover. Crema uses
  `node:test`; swap the import to `vitest` (keeping `node:assert/strict` is
  fine) and fix paths.

## Ported files (licensing)

Every file derived from Crema (code or tests) starts with exactly:

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Derived from Crema web/src/<path> (https://github.com/yarneo/crema @ 628cd714),
// Copyright (C) 2026 Yarden (yarneo). Modified for CafAI: <one line on what changed>.
```

New files need no header.

## Before you report

- `npx tsc -p tsconfig.json --noEmit` shows no errors in YOUR files (other
  agents' in-progress files may have errors; filter with grep).
- `npx eslint <your paths>` is clean.
- `npx vitest run <your paths>` passes.

## Final report (your last message, at most 60 lines)

Files created (grouped); public API (exports with signatures); tests (count,
all passing?); Crema files ported and their tests; deviations from the
contracts or your brief, with reasons; proposed shared-contract changes;
known gaps and TODOs; anything the integrator must wire up.
