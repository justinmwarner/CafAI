# contract/decaid: CafAI against Decaid's published API

CafAI's wire types (`src/api/types.ts`, plus `src/coach/types.ts` and
`src/api/grinders.ts`) are hand-written and follow Decaid's Dart code. This
folder checks them against the specs of the Decaid release CafAI is verified
with (D93, D94; spec 4.1 to 4.3 of
`docs/superpowers/specs/2026-10-09-decaid-alignment-design.md`). Nothing here
is bundled into the app.

| Path | What it is |
|---|---|
| `PIN.json` | The pinned release and commit, the sha256 of both specs, the generator |
| `spec/rest_v1.yml`, `spec/websocket_v1.yml` | Decaid's `assets/api/` specs at the pin, verbatim |
| `generated/rest.ts`, `generated/ws.ts` | openapi-typescript output; `ws.ts` also has the channel map (`WsReceive`, `WsSend`). Never edited by hand |
| `helpers.ts` | `Diff`, `Extra`, `EnumDrift`, `Exactly`, and accessors by path (`Res`, `Body`, `Statuses`, `PathParams`) |
| `checks/*.ts` | The assertions: REST replies, REST bodies, WebSocket frames, enums, status codes |
| `drift.ts` | The exception registry: type fragments for the checks, runtime exceptions for ajv |
| `schema.ts` | The specs as ajv validators (`loadSpecValidator()`), for the mock contract test and the tests against a real Decaid |

`npm run typecheck` runs CafAI's own typecheck, then
`tsc -p tsconfig.contract.json` (the checks), then
`node scripts/decaid-contract.mjs --check` (the specs match `PIN.json` and
regenerate to the committed files). `mock/decaid/contract.test.ts` validates
the fixtures, the mock's replies and frames, and the bodies CafAI sends with
`schema.ts`. `npm run decaid:watch` (daily in `.github/workflows/decaid-watch.yml`)
runs the same checks against Decaid's latest release and `main`.

## Moving the pin

1. `npm run decaid:update -- v0.9.0` (a tag, a branch or a sha). It
   downloads both specs at that commit, regenerates, and rewrites `PIN.json`
   and `src/api/decaidVersion.ts` (About shows the release, D96).
2. `npm run typecheck` and `npx vitest run mock/decaid/contract.test.ts scripts`.
3. Work through what fails (below): fix `src/api/types.ts` where Decaid
   changed, delete exceptions Decaid fixed, record new ones with their reason.
4. Update the Dart citations in `drift.ts` to the new commit where the cited
   files changed, and `docs/upstream/decaid-spec-fixes.md` if Decent fixed
   something.

The drift watch's report says in advance which exceptions turn stale and
which checks fail.

## Reading a failing check

Each check is a type such as

```ts
export type _workflow = Assert<Exactly<Diff<Res<'/api/v1/workflow', 'get'>, C.Workflow>, X.WorkflowRead>>;
```

Reads diff the spec's reply against CafAI's type (what Decaid may send must
fit what CafAI expects); writes diff CafAI's body against the spec's (what
CafAI sends must fit what Decaid documents). A failure names the field:

- `{ unexpected: "pressure: null not accepted" }`: the spec now says
  something CafAI's type does not accept. Find out what Decaid's Dart code
  does at the pin. If Decaid really sends it, change CafAI's type and the
  reader that parses it (`src/api/readers.ts`, `frames.ts`). If the spec is
  wrong and Dart is not, record an exception.
- `{ stale: "context.grinderBurrs: absent in source (optional in target)" }`:
  Decaid fixed what an exception records. Delete it from `drift.ts`.
- `optional in source, required in target`: the spec has no `required` for a
  key CafAI needs. `absent in source`: the spec does not have the key at all.
  `'x' not accepted` / `CafAI only: x` / `spec only: x`: an enum value one
  side lacks.
- A route, method or status that disappeared shows as `(source): not in the
  spec` or as a compile error on the path itself.

A runtime problem from `schema.ts` reads `"measurements[3].machine.pressure: must be number"`:
a field path in the payload and what the spec wanted.

## Adding an exception

Only when the spec is wrong and CafAI follows Decaid's Dart code, or when
CafAI's type differs on purpose. Every exception says which kind it is, why,
and the Dart file:line at the pin that proves it, in this form:

```ts
/** SPEC GAP: MachineInfo has no `required`; its toJson always sends the four (lib/src/models/device/machine.dart:26-34). */
export type MachineInfoRead = Opt<'', 'GHC' | 'model' | 'serialNumber' | 'version'>;
```

| Kind | Meaning |
|---|---|
| SPEC GAP | the spec omits `required` (or a value); Dart always sends it |
| SPEC DRIFT | the spec contradicts Dart |
| CAFAI NARROWER | CafAI's type is stricter than the spec, as Dart is |
| CAFAI LOOSER | CafAI's type accepts or sends more than the spec, on purpose |
| PARSED SHAPE | CafAI's type is what its parser returns, not the raw frame |

A type exception is a fragment in `drift.ts` (built with `Opt`, `NullIn`,
`Absent`, `AbsentOpt`, `Undeclared`, `SpecOnly`, `CafaiOnly`, with a path
prefix) that the check expects exactly. A runtime exception is an entry in
`SPEC_EXCEPTIONS`, matched by where (`any`, an operation as the spec writes
it, or a channel), the ajv keyword, and as narrowly as it can be: the spec
location of the failing schema, the field path, the value.

Do not add an exception:

- to make a check pass when Decaid's Dart code really sends something new.
  Change CafAI's type and its reader, so the app handles it (D95);
- without the Dart evidence. If you cannot find the line, the spec may be
  right and CafAI wrong;
- wider than the problem: one schema location or field, not `any` keyword;
- for a CafAI bug. Fix the bug.
