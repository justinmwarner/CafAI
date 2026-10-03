# Coach test fixtures

Test-only data. Nothing here is imported by app code.

## Decaid bundled profiles (hash test vectors)

Verbatim copies of bundled default profiles from **Decaid**
(`decentespresso/decaid`), commit `a45961b323831d2170b3e7f3fef7c72fdd341642`,
copied with `git -C .ref/decaid cat-file blob <commit>:assets/defaultProfiles/<file>`
(LF line endings, byte-identical to the git blobs).

| File | Origin path | Git blob id | Expected Decaid id |
|---|---|---|---|
| `Default1.json` | `assets/defaultProfiles/Default1.json` | `f939ecc1e29055aaf79518a0a025fd57b65cccdb` | `profile:a582ef47a76f99f56912` |
| `best_practice.json` | `assets/defaultProfiles/best_practice.json` | `ea76773d43628f14b11012d2fc31f39e170b4e97` | `profile:b73ce54592d667d00b31` |

Check a copy with `git -C .ref/decaid hash-object --no-filters <copy>`.

Licence: Decaid is GPL-3.0-or-later, "Copyright (C) 2025-2026 Decent Espresso"
(`LICENSE.txt`). Keep the files' `author` and `notes` intact.

## decaid-mcp real shots (`decaid-mcp/`)

Real, anonymised Decaid 0.8.6+2801 shot records from **decaid-mcp**
(`The-Walker443/decaid-mcp`), commit `aecef96b870e4f3567ed5f08c876f77adf25f5a7`,
`test/fixtures/shots/`. They are re-serialized without whitespace
(`JSON.stringify(JSON.parse(original))`), so the content is identical but the
bytes are smaller. The analysis tests compare CafAI's port of decaid-mcp's
diagnostics with that project's golden values (`test/golden/shot-NN.json`).

| File | Why | SHA-256 of the original file |
|---|---|---|
| `shot-01.json` | Default profile; resistance falls steeply (one indicator fires) | `0f4d18e53d037bd4e8f4f9ae5c3e8d4a77828c2e2c44e153f176d156742c7821` |
| `shot-06.json` | Adaptive v3; pressure dip after the peak fires | `a8136afe46220642552ae3ca499dc8a323fc7a0f9bf206222641a845bb5ae6be` |
| `shot-07.json` | Blooming Espresso; no settled pressure, so no channeling verdict | `f510903b1a07e257c129451b077cd0953de3d9b4f5350ccef38961ae921c4a22` |
| `shot-09.json` | Aborted after one second; degenerate input with scale warnings | `e3152816c34293759eebb5e1cf679f0df61e666a70cc042dca623634bfb081f5` |

Licence: decaid-mcp is GPL-3.0-or-later (Copyright (C) 2026 The-Walker443),
used here under GPL-3.0.

## Synthetic shots

`syntheticShot.ts` is CafAI's own deterministic ShotRecord generator for
tests (irregular ~4 Hz sampling, with options that trigger each channeling
indicator).
