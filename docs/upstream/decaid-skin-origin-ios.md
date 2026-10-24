# A skin's origin moves with every iOS update of Decaid: a draft for Decent

Status: draft (D231). CafAI does not send it; the owner decides whether to
open it on [decentespresso/decaid](https://github.com/decentespresso/decaid).

Seen on the owner's iPad on 2026-10-23, with Decaid 0.9.0 (build
`b9f9d055`) from the App Store. Code locations are at that build, and are
unchanged on `main` at `f2248a75` (2026-10-22).

---

## Issue text

**Title:** On iOS every Decaid update gives each skin a new origin, so skins lose their localStorage and IndexedDB

**Body:**

The skins documentation promises: "Each installed skin is served from its
own stable origin — a port derived from the skin's identity and remembered
across restarts. Persistent browser storage is keyed by origin, so
`localStorage` and IndexedDB written by a skin are still there the next time
the app starts." On iOS that holds across restarts, but not across an update
of Decaid itself.

**What happens.** The identity a skin's port is derived from is the skin
folder's absolute path: `skinIdentityProvider` is declared but never
assigned in `lib/`, so `identity = identityProvider == null ? path :
identityProvider(path)` uses the path
(`lib/src/webui_support/webui_service.dart:337-339`), and `_serveStable`
looks it up in the `webUISkinPorts` preference, or derives a new port from
it with FNV-1a (`webui_service.dart:429-461`). On iOS that path holds the
app's data container, `/var/mobile/Containers/Data/Application/<UUID>/`,
and iOS gave the container a new UUID when the App Store updated Decaid. The
new path has no entry in `webUISkinPorts`, so every skin gets a new port,
which is a new origin: its storage under the old one is still on the device,
but no page can reach it again.

**From the iPad's log** (`GET /api/v1/logs`), one skin (CafAI), before and
after the update:

```
2026-10-22 08:17:16 WebUIStorage - Installed WebUI skin: streamline.js at /var/mobile/Containers/Data/Application/E1952A25-7E00-46FA-BDCC-2AD9793A5CE9/Documents/web-ui/streamline.js
2026-10-23 13:57:52 SkinView - Page started loading: http://localhost:26493/?_=1792781872649
2026-10-23 19:23:21 WebViewLogService - WebViewLogService initialized: /var/mobile/Containers/Data/Application/D5CA0338-2387-4A81-B74E-704C6A87578F/Documents/webview_console.log
2026-10-23 19:23:21  - ==== Decent starting ====
2026-10-23 19:23:21  - version: 0.9.0, platform: ios
2026-10-23 19:23:38 SkinView - Page started loading: http://localhost:27749/?_=...
```

The same skin, unchanged on disk under `Documents/web-ui/cafai`, was served
from `localhost:26493` from 2026-10-12 to 13:57 that day, and from
`localhost:27749` after the update. A skin that keeps its settings in the
browser's storage starts empty after every Decaid update on iOS.

**Suggested fix.** Derive the identity from the path relative to the
web-ui folder (or from the skin's id), not from the absolute path, and
migrate `webUISkinPorts` once: an entry whose path ends in
`/Documents/web-ui/<folder>` gives its port to the new identity (where an
update has already added a second entry, the older one is the origin with
the data from before). Updated devices would then find their skins' old
origins again, and their storage with them. `skinIdentityProvider` looks
like it was meant for exactly this.

**What we do meanwhile.** CafAI keeps what must outlive the origin in the
key-value store, which the docs say is unaffected by origin: a backup of
its records, and copies of a few settings. Anything a skin keeps only in
the browser is lost at each update on iOS.

---

## Notes for the owner

- On Android the app's data path does not change with an update, so this is
  iOS only (and any platform whose data folder moves, which
  `doc/AI_STORAGE_NOTES.md` in Decaid mentions for desktops).
- CafAI's side is D229 and D230: where the coach runs is copied in
  Decaid's store, on by default. The API key's copy (D99) stays off by
  default, so on an iPad a key must be pasted again after each Decaid
  update unless **Keep my API key in Decaid** is on.
- docs/verified/01-platform.md section 2 lists the absolute-path identity;
  the iOS move is no longer an inference there.
