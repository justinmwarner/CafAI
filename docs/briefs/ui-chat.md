# Brief: chat UI (coach, history, settings screens)

Read `docs/briefs/COMMON.md` first; its rules apply.

**You own:** `src/ui/chat/**`, `src/ui/history/**`, `src/ui/settings/**`.
Everything else is read-only (the baseline UI agent owns the shell, theme and
machine panel; `src/ui/testIds.ts` and `src/ui/testing/fakeServices.ts` are
shared).

**Read:** `src/app/types.ts` (`CoachState`, `CoachController`,
`CoachUiMessage`, `CoachUiPart`, `Services`), `src/app/services.tsx`
(`useServices`, `useCoach`), `src/storage/types.ts`, `src/coach/types.ts`
(`ShotSummary`), `src/coach/contract.ts` (`OTHER_OPTION`), `src/ui/testIds.ts`,
`src/ui/testing/fakeServices.ts`, `DECISIONS.md` (D3, D22, D24),
`docs/CREMA_PORT_PLAN.md` section 10 "[7] Chat UI" (concepts to carry over).
The installed `@mui/x-chat` 9.0.0-alpha.18 types live in
`node_modules/@mui/x-chat` and `node_modules/@mui/x-chat-headless`.

## The coach loop you render

New bag -> a placeholder message asks for origin, roast, process and notes ->
the model suggests 2-5 templates as cards with rough confidence -> the user
taps one (that creates and loads "<Bean> v1") -> after a shot, a shot card
appears and the model asks how it tasted with tappable options, "Other"
always last -> the model proposes ONE change as a plain-language diff card
that needs a Confirm tap; Undo returns to the previous version -> repeat.
The engine owns all state; you render `CoachState` and call the controller.

## Build

1. `chat/ChatSurface.tsx`: the ONLY module that imports `@mui/x-chat`.
   Props (refine if needed, keep it controlled):
   `{ messages: CoachUiMessage[]; busy: boolean; inputDisabled?: boolean; placeholder: string; canUndo: boolean; onSend(text): void; onPickTemplate(requestId, templateId): void; onAnswerOptions(requestId, selected, otherText): void; onConfirm(requestId): void; onDecline(requestId): void; onUndo(): void }`.
   - Map `CoachUiMessage[]` to x-chat messages in CONTROLLED mode
     (`messages` prop); text parts -> text parts; every other part kind ->
     a custom data part rendered by your part components (`partRenderers`).
     Streaming text updates arrive as new props; the adapter's
     `sendMessage` just calls `onSend` and returns an already-closed stream.
   - Model text must not render raw HTML (check how x-chat renders markdown
     and disable HTML, or render plain text with line breaks).
   - Hide the attach button (no files or camera tonight). Put
     `TID.composerInput` / `TID.composerSend` on the composer via slotProps.
     Disable send while `busy` or `inputDisabled`, but keep typing allowed.
   - Keep the newest message in view.
   - If controlled mode in this alpha cannot work, write a simple chat on
     core MUI behind the same props (allowed fallback) and document why.
2. `chat/parts/`:
   - `TemplateCards` (`TID.templateCard(id)`, `TID.templatePick(id)`): name,
     style, shape line, a confidence chip (low / medium / high), the reason,
     and a "Use this" button; after a pick, mark it and disable the others.
   - `OptionChips` (`TID.optionChip(label)`, `TID.optionsSubmit`,
     `TID.otherInput`): the question and chips (48 px tall). Single-select
     sends on tap; multi-select toggles then "Send". "Other" (always last;
     the engine guarantees it) opens an inline text field with Send. Once
     answered, show the answer and disable.
   - `DiffCard` (`TID.diffCard`, `TID.diffConfirm`, `TID.diffCancel`,
     `TID.undoButton`): headline summary, before -> after lines, manual steps
     ("Grind 1 step finer"), rationale, expected effect, the version label it
     will create; Confirm and "Not now"; statuses: applying (progress),
     applied ("Loaded as v3" + Undo when `canUndo` and this is the latest
     applied card), declined, failed (error text), undone.
   - `ShotCard` (`TID.shotCard`): duration, dose -> yield and ratio, peak
     pressure, first drop, channeling flags in words, and a tiny inline SVG
     sparkline of pressure and flow from `summary.series` (no uPlot here).
   - `Notice`: info / success / warning / error line.
3. `chat/CoachScreen.tsx`: reads `useCoach(...)`, calls `services.coach`.
   Header strip: bag picker (`TID.bagPicker`, existing bags), "New bag"
   (`TID.newBag`), active version chip (`TID.activeVersion`, e.g. "Kiambu AA
   v2"), Undo (`TID.undoButton`) when `canUndo`. Body: `ChatSurface`. Empty
   states: no API key -> a card that links to `#/settings` ("Add your
   Anthropic API key to start coaching"); no bag -> a large "New bag" call to
   action. Error banner (`TID.errorBanner`) with Retry (`TID.retryButton`)
   and dismiss.
4. `history/HistoryScreen.tsx` (route `#/history` and `#/history/<bagId>`):
   bag list (`TID.historyBag(id)`) -> the per-bag version history
   (`TID.historyVersion(n)`): version, date, template, the change as diff
   lines, status (active / superseded / undone), and under each version its
   iterations (`TID.historyIteration(id)`): shot metrics, feedback, the
   proposal, the outcome. Reads `services.storage` directly; refreshes when
   the coach state changes. Export (`TID.exportData`): `porter.exportAll()`
   then download a JSON file (Blob + `a[download]`), with a fallback dialog
   showing the JSON for copying (downloads may not work inside the WebView).
   Import (`TID.importData`): `<input type="file" accept="application/json">`
   -> `porter.importAll(data, 'merge')` -> result message.
5. `settings/SettingsScreen.tsx` (route `#/settings`): Anthropic API key
   (`TID.apiKeyInput`, password field with show/hide) + Save
   (`TID.apiKeySave`) -> `storage.secrets.setApiKey` then
   `coach.refresh()`. After saving never display the key again ("A key is
   saved on this tablet"). Forget key (`TID.forgetKey`, with a confirm step)
   -> `forgetApiKey` + `refresh`. Model select (`TID.modelSelect`) from
   `services.models` (label, note, price per MTok); grinder name
   (`TID.grinderName`) and current setting (`TID.grinderSetting`); Save
   (`TID.settingsSave`) -> `storage.settings.update` + `refresh`. Explain in
   one line that the key stays on this tablet and is never sent to Decaid or
   included in exports. Show the app version and Decaid host version.
6. A dev preview for your own visual check: `dev/preview-chat.html` +
   `src/ui/chat/preview/chatPreview.tsx` rendering the three screens with
   `createFakeServices()` and a fake coach state containing every part kind.
   Run `npx vite --port 5182 --strictPort`, screenshot with a short
   Playwright script at 962x602 and 1280x800, LOOK at the images with the
   Read tool, and fix what looks wrong. Delete temporary scripts afterwards
   (keep the preview).

## Tests (RTL, jsdom)

Each part kind renders and fires the right callback; "Other" is last and
opens the input; single vs multi select; DiffCard confirm / decline / undo
and status rendering; ChatSurface renders messages in order and calls
`onSend`; CoachScreen empty states (no key, no bag) and error banner retry;
HistoryScreen lists versions and iterations from a seeded fake storage and
export calls the porter; SettingsScreen saves and forgets the key without
rendering it back, persists model and grinder, and calls `coach.refresh()`.
jsdom lacks `ResizeObserver` (and maybe `scrollIntoView`): stub them in your
test setup locally.
