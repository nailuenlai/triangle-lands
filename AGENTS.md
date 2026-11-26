## Agent skills

### Issue tracker

Issues and specs for this repo are tracked as GitHub Issues (`nailuenlai/triangle-lands`). See `docs/agents/issue-tracker.md`.

### Triage labels

Default five canonical triage roles (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout (`GLOSSARY.md` and `docs/adr/` at the repo root, created lazily via `/domain-modeling`). See `docs/agents/domain.md`.

### Coding standards & verification

- **Review & shader/UI/framing judgement calls**: read `CODING_STANDARDS.md`.
- **Visual verification, sightline debugging, or deterministic Playwright checks**: drive the DEV harness `window.__game` (`snapAt`, `setCamOverride`, `stepDiscovery`, `sim` at the bottom of `src/main.ts`), capture single-session headless WebGL shots via `npm run snap`, or import `src/terrain.ts` directly in Node (`node --experimental-strip-types`, zero Three.js dependency).
