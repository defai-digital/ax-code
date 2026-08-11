# MODULE-AUDIT: util

| Field | Value |
|-------|-------|
| Unit slug | `util` |
| Scope | `packages/ax-code/src/util` |
| Resolved root | `packages/ax-code/src/util` |
| XL filter | no |
| Wave / effort | Wave 10 / L |
| Risk tags | quality |
| Status | REVIEWING |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `94e95c161c7deb8e055d8806a5f285e516285715` |
| Analysis fingerprint | `c4c0f6b0d01677d2` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 54 / 4059 |
| Inventory ID | W10-04 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/util/abort.ts` | 36 | 2 | 0 | 0 |
| `packages/ax-code/src/util/archive.ts` | 23 | 2 | 0 | 0 |
| `packages/ax-code/src/util/color.ts` | 20 | 4 | 0 | 0 |
| `packages/ax-code/src/util/concurrency.ts` | 100 | 4 | 0 | 0 |
| `packages/ax-code/src/util/context.ts` | 29 | 3 | 0 | 0 |
| `packages/ax-code/src/util/data-url.ts` | 18 | 1 | 0 | 0 |
| `packages/ax-code/src/util/defer.ts` | 13 | 1 | 0 | 0 |
| `packages/ax-code/src/util/directory-headers.ts` | 21 | 5 | 0 | 0 |
| `packages/ax-code/src/util/env.ts` | 151 | 8 | 0 | 0 |
| `packages/ax-code/src/util/error-message.ts` | 19 | 3 | 0 | 0 |
| `packages/ax-code/src/util/fan-out.ts` | 78 | 4 | 0 | 0 |
| `packages/ax-code/src/util/feature-flags.ts` | 6 | 2 | 0 | 0 |
| `packages/ax-code/src/util/filelock.ts` | 165 | 2 | 0 | 0 |
| `packages/ax-code/src/util/filesystem.ts` | 273 | 25 | 0 | 0 |
| `packages/ax-code/src/util/fn.ts` | 19 | 1 | 0 | 0 |
| `packages/ax-code/src/util/format.ts` | 29 | 2 | 0 | 0 |
| `packages/ax-code/src/util/git-output.ts` | 92 | 9 | 0 | 0 |
| `packages/ax-code/src/util/git.ts` | 59 | 2 | 0 | 0 |
| `packages/ax-code/src/util/glob.ts` | 46 | 5 | 0 | 0 |
| `packages/ax-code/src/util/harmless-interrupt.ts` | 54 | 1 | 0 | 0 |
| `packages/ax-code/src/util/hash.ts` | 8 | 2 | 0 | 0 |
| `packages/ax-code/src/util/http-header.ts` | 9 | 1 | 0 | 0 |
| `packages/ax-code/src/util/iife.ts` | 4 | 1 | 0 | 0 |
| `packages/ax-code/src/util/internal-url.ts` | 27 | 2 | 0 | 0 |
| `packages/ax-code/src/util/json-record.ts` | 18 | 2 | 0 | 0 |
| `packages/ax-code/src/util/json-value.ts` | 40 | 4 | 0 | 0 |
| `packages/ax-code/src/util/keybind.ts` | 124 | 9 | 0 | 0 |
| `packages/ax-code/src/util/lazy.ts` | 34 | 2 | 0 | 0 |
| `packages/ax-code/src/util/levenshtein.ts` | 21 | 1 | 0 | 0 |
| `packages/ax-code/src/util/local-host.ts` | 25 | 1 | 0 | 0 |

### Exports (sample)
- `abortAfter@packages/ax-code/src/util/abort.ts:11`
- `abortAfterAny@packages/ax-code/src/util/abort.ts:28`
- `Archive@packages/ax-code/src/util/archive.ts:4`
- `extractZip@packages/ax-code/src/util/archive.ts:5`
- `Color@packages/ax-code/src/util/color.ts:1`
- `isValidHex@packages/ax-code/src/util/color.ts:2`
- `hexToRgb@packages/ax-code/src/util/color.ts:7`
- `hexToAnsiBold@packages/ax-code/src/util/color.ts:14`
- `ConcurrencyLimiter@packages/ax-code/src/util/concurrency.ts:9`
- `createConcurrencyLimiter@packages/ax-code/src/util/concurrency.ts:24`
- `mapWithConcurrency@packages/ax-code/src/util/concurrency.ts:73`
- `OutboundLimits@packages/ax-code/src/util/concurrency.ts:94`
- `Context@packages/ax-code/src/util/context.ts:3`
- `NotFound@packages/ax-code/src/util/context.ts:4`
- `create@packages/ax-code/src/util/context.ts:10`
- `decodeDataUrl@packages/ax-code/src/util/data-url.ts:1`
- `defer@packages/ax-code/src/util/defer.ts:1`
- `AX_CODE_DIRECTORY_HEADER@packages/ax-code/src/util/directory-headers.ts:1`
- `LEGACY_OPENCODE_DIRECTORY_HEADER@packages/ax-code/src/util/directory-headers.ts:2`
- `encodeDirectoryHeader@packages/ax-code/src/util/directory-headers.ts:4`

### Tests
- `packages/ax-code/test/cli/tui/json-util.test.ts`
- `packages/ax-code/test/debug-engine/scanner-utils.test.ts`
- `packages/ax-code/test/util/concurrency.test.ts`
- `packages/ax-code/test/util/data-url.test.ts`
- `packages/ax-code/test/util/directory-headers.test.ts`
- `packages/ax-code/test/util/env.test.ts`
- `packages/ax-code/test/util/error-message.test.ts`
- `packages/ax-code/test/util/fan-out.test.ts`
- `packages/ax-code/test/util/filelock.test.ts`
- `packages/ax-code/test/util/filesystem.test.ts`
- `packages/ax-code/test/util/format.test.ts`
- `packages/ax-code/test/util/glob.test.ts`
- `packages/ax-code/test/util/harmless-interrupt.test.ts`
- `packages/ax-code/test/util/http-header.test.ts`
- `packages/ax-code/test/util/iife.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (219) | static map |
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
| Static extract | ok fp `c4c0f6b0d01677d2` |
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
