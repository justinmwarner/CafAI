# Template sources

The five JSON files in this folder are verbatim copies of bundled default profiles from **Decaid** (`decentespresso/decaid`).

- **Commit:** `a45961b323831d2170b3e7f3fef7c72fdd341642` (2026-10-01, "test(import): make backup rejection callsites deterministic")
- **Local reference clone:** `.ref/decaid`

Do not edit these files. CafAI derives adjusted profiles from them at runtime. The analysis is in `docs/verified/03-profiles.md` §9.

| File | Origin path in Decaid | Git blob id at the commit | SHA-256 of these bytes | Bytes |
|---|---|---|---|---|
| `Blooming_espresso.json` | `assets/defaultProfiles/Blooming_espresso.json` | `ad6bd97685fbf9c0aa81689e0e0003729a607c06` | `2cf0d39cf9a539ab26ab99c6e08e714223a33a11e2bce5e410d6a1852dabc90b` | 2745 |
| `D-Flow____default.json` | `assets/defaultProfiles/D-Flow____default.json` | `7983ae71dc6a19826ee2f17596a22711bb0f961b` | `f291d6574d78869a8d23011ee8171c9b2a73f75e9efcf2a2afc600d9f50e1e30` | 1690 |
| `Londonium.json` | `assets/defaultProfiles/Londonium.json` | `1daf983cefada0e60479a68318606c566a1b628e` | `1b7eaafd21d78ada9b46f7bfc13dd8a4e4841955396f69e1489dfdf7b8632378` | 2909 |
| `rao_allonge.json` | `assets/defaultProfiles/rao_allonge.json` | `cc0cfa219aa6814eb599f203ec53469cb305673c` | `d6207f1147ca7b7e3c66ea862111a0e01c3d47a7ffd7ee6acbfa65fb0606df3f` | 1476 |
| `Gentle_and_sweet1.json` | `assets/defaultProfiles/Gentle_and_sweet1.json` | `db86dcad62ce6277f934e703568f2df6a2c87a96` | `351c09547c485acdd92c00b29b98fb1d81a3e420e25d485309cd1cb5d9858757` | 2311 |

All five files are listed in Decaid's `assets/defaultProfiles/manifest.json`. The `1` in `Gentle_and_sweet1.json` is only in Decaid's file name; the title is "Gentle and sweet" (`doc/plans/archive/default-profiles-curation/curation.md:184-186`).

## How the files were copied

Each file was copied with this command:

```sh
git -C .ref/decaid cat-file blob a45961b323831d2170b3e7f3fef7c72fdd341642:assets/defaultProfiles/<file> > <file>
```

To check a copy, run `git -C .ref/decaid hash-object --no-filters <copy>`. The result must equal the blob id in the table. `src/coach/templates/index.test.ts` recomputes every blob id from the bytes on disk.

These files have LF line endings, the same as the repository. The Windows working tree at `.ref/decaid` has CRLF endings because `core.autocrlf=true`, so its bytes (2845, 1762, 3027, 1527 and 2404) differ from these copies only in line endings. The copies are the canonical committed bytes.

## Attribution and credit (as recorded in each file)

| File | `title` | `author` field | Credit in `notes` |
|---|---|---|---|
| `Blooming_espresso.json` | Blooming Espresso | `Decent` | Credits Scott Rao's blooming technique ("when Rao first published it") |
| `D-Flow____default.json` | `D-Flow \/ default` (the JSON escape for "D-Flow / default") | `Damian` | "A simple to use profiling system By Damian Brakel" |
| `Londonium.json` | Londonium | `Decent` | "By Damian Brakel". It is "identical to the LRv2 profile, but renamed". The sibling `Damian_s_LRv2.json` carries `author: Damian`. |
| `rao_allonge.json` | `Rao Allongé` | `Decent` | None by name; the title credits Scott Rao's allongé technique. |
| `Gentle_and_sweet1.json` | Gentle and sweet | `Decent` | None. |

Decaid's own attribution policy is "`Decent` default + community overrides" (`doc/plans/archive/default-profiles-curation/curation.md:208`). Its audit still lists Londonium's author as TBD (`doc/plans/archive/default-profiles-curation/audit.md:91`). Keep the `author` and `notes` fields intact wherever these profiles are shown or redistributed.

## License

Decaid is licensed under the **GNU GPL, version 3 or (at your option) any later version**. `LICENSE.txt` reads: "Copyright (C) 2025-2026 Decent Espresso … either version 3 of the License, or (at your option) any later version." `README.md` §License says GPL-3.0.

There is no separate license for `assets/defaultProfiles/`, so these files are distributed under Decaid's GPL-3.0-or-later. Any CafAI distribution that bundles them must comply with the GPL. RESEARCH.md already recommends GPL-3.0 for CafAI.

## Expected Decaid record ids

Decaid identifies a profile by a hash of its content. These are the ids that Decaid should assign to the five templates:

| File | Expected id |
|---|---|
| `Blooming_espresso.json` | `profile:7438cb7266f60558b48f` |
| `D-Flow____default.json` | `profile:59036f8846b1ed3b4255` |
| `Londonium.json` | `profile:729d284747718d27c93a` |
| `rao_allonge.json` | `profile:372f1be4c5e3641bbfe2` |
| `Gentle_and_sweet1.json` | `profile:1baa29bd9d9dc6d47f2a` |

These ids were computed with a port of `lib/src/models/data/profile_hash.dart`. The port was checked against `best_practice.json`: it returns `profile:b73ce54592d667d00b31`, which matches the `parent_id` that Decaid hard-codes in `best_practice_v3.json`. The last two ids were also computed by the mock gateway's separate port (`mock/decaid/profiles.ts`) and by a Python port, and all three agree.

Confirm the ids on a live Decaid with `GET /api/v1/profiles?includeHidden=true`. Bundled records carry `metadata.filename`.
