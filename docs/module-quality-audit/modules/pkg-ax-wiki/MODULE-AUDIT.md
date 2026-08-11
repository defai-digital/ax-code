# MODULE-AUDIT: pkg-ax-wiki

| Field | Value |
|-------|-------|
| Unit slug | `pkg-ax-wiki` |
| Scope | `packages/ax-wiki` |
| Resolved root | `packages/ax-wiki` |
| XL filter | no |
| Wave / effort | Wave 9 / L |
| Risk tags | quality |
| Status | REVIEWING |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `ad9a854c3f8f6cc3ffc48c356a2546d3f23e9945` |
| Analysis fingerprint | `2e1d9159a35cbc77` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 19 / 1924 |
| Inventory ID | W9-08 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-wiki/src/agents.ts` | 82 | 5 | 0 | 0 |
| `packages/ax-wiki/src/artifacts.ts` | 250 | 11 | 0 | 0 |
| `packages/ax-wiki/src/build.ts` | 304 | 3 | 0 | 0 |
| `packages/ax-wiki/src/discovery.ts` | 202 | 2 | 0 | 0 |
| `packages/ax-wiki/src/frontmatter.ts` | 93 | 2 | 0 | 0 |
| `packages/ax-wiki/src/glob.ts` | 41 | 3 | 0 | 0 |
| `packages/ax-wiki/src/hash.ts` | 20 | 2 | 0 | 0 |
| `packages/ax-wiki/src/index.ts` | 15 | 0 | 0 | 0 |
| `packages/ax-wiki/src/paths.ts` | 42 | 13 | 0 | 0 |
| `packages/ax-wiki/src/plan.ts` | 184 | 3 | 0 | 0 |
| `packages/ax-wiki/src/protected.ts` | 68 | 6 | 0 | 0 |
| `packages/ax-wiki/src/protocol.ts` | 39 | 2 | 0 | 0 |
| `packages/ax-wiki/src/safety.ts` | 29 | 1 | 0 | 0 |
| `packages/ax-wiki/src/types.ts` | 168 | 21 | 0 | 0 |
| `packages/ax-wiki/src/validate.ts` | 148 | 1 | 0 | 0 |
| `packages/ax-wiki/test/artifacts.test.ts` | 69 | 0 | 0 | 0 |
| `packages/ax-wiki/test/build.test.ts` | 123 | 5 | 0 | 0 |
| `packages/ax-wiki/test/plan.test.ts` | 37 | 0 | 0 | 0 |
| `packages/ax-wiki/vitest.config.ts` | 10 | 0 | 0 | 0 |

### Exports (sample)
- `hasAxWikiBlock@packages/ax-wiki/src/agents.ts:6`
- `defaultAxWikiBlock@packages/ax-wiki/src/agents.ts:10`
- `upsertAxWikiBlock@packages/ax-wiki/src/agents.ts:29`
- `EnsureAgentsResult@packages/ax-wiki/src/agents.ts:45`
- `ensureAgentsWikiPointers@packages/ax-wiki/src/agents.ts:47`
- `listMarkdownFiles@packages/ax-wiki/src/artifacts.ts:19`
- `loadWikiPages@packages/ax-wiki/src/artifacts.ts:39`
- `cardsFromPages@packages/ax-wiki/src/artifacts.ts:64`
- `renderCardsMarkdown@packages/ax-wiki/src/artifacts.ts:87`
- `buildWikiCards@packages/ax-wiki/src/artifacts.ts:110`
- `writeWikiCards@packages/ax-wiki/src/artifacts.ts:126`
- `relatedWikiPages@packages/ax-wiki/src/artifacts.ts:131`
- `WikiStatus@packages/ax-wiki/src/artifacts.ts:154`
- `getWikiStatus@packages/ax-wiki/src/artifacts.ts:167`
- `lintWiki@packages/ax-wiki/src/artifacts.ts:211`
- `pageContentHash@packages/ax-wiki/src/artifacts.ts:247`
- `loadAxWikiConfig@packages/ax-wiki/src/build.ts:39`
- `loadWikiManifest@packages/ax-wiki/src/build.ts:53`
- `buildAxWiki@packages/ax-wiki/src/build.ts:112`
- `discoverSources@packages/ax-wiki/src/discovery.ts:139`

### Tests
- none auto-matched

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (80) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags quality | hotspot scan |

## 3–7. Protocol steps 3–7

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `2e1d9159a35cbc77` |
| Dual-agent protocol | PENDING |
| Critical independent verify | pending |

### Exit checklist
- [ ] Full 9-step protocol by dual-agent/implementer
- [x] Map with unit-scoped files (XL filters applied when configured)
- [x] Findings ledger consistent with findings/ files
- [ ] Sign-off roles complete

### Sign-off

| Role | Name | Date | Evidence |
|------|------|------|----------|
| Reviewer | — | — | protocol pending |
| Independent verifier | — | — | pending |
| Module owner | — | — | REVIEWING |
