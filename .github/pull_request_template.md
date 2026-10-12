## What and why

<!-- What changes, and the problem it solves. Link the issue: "Fixes #123". -->

## How it was checked

- [ ] `npm run typecheck`, `npm run lint` and `npm test`
- [ ] `npm run e2e` (screens or the coach's flow changed)
- [ ] `npm run build` and `npm run release:zip` (the build or the zip changed)
- [ ] Chromium 91: `npm run smoke:chrome91` and `npm run smoke:chrome91:loop` (new browser APIs or syntax)
- [ ] Decaid's simulator: `npm run test:decaid` (anything CafAI sends to or reads from Decaid; docs/SIMULATOR.md)
- [ ] On a real machine (say which tablet and which Decaid)

## Checklist

- [ ] One change, with tests that cover it
- [ ] A DECISIONS.md entry, if this settles a design or platform question
- [ ] The README or docs follow, if behaviour or setup changed; `npm run screenshots`, if the screens changed
- [ ] A line in CHANGELOG.md under "Unreleased", if a user would notice
- [ ] No secrets or personal data: API keys, pairing codes, Decaid backups, home addresses
- [ ] Code from another project has a compatible licence, a header naming its origin, and a NOTICE entry
