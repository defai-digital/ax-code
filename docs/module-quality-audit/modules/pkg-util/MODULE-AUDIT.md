# MODULE-AUDIT: pkg-util

| Field | Value |
|-------|-------|
| Unit slug | `pkg-util` |
| Scope | `packages/util` |
| Resolved root | `packages/util` |
| XL filter | no |
| Wave / effort | Wave 9 / M |
| Risk tags | quality |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `994f9287e497666e104644eccea299595a35b39a` |
| Analysis fingerprint | `b0f9b1558ec9a05c` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 13 / 443 |
| Inventory ID | W9-03 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/util/src/array.ts` | 11 | 1 | 0 | 0 |
| `packages/util/src/binary.ts` | 42 | 3 | 0 | 0 |
| `packages/util/src/encode.ts` | 53 | 5 | 0 | 0 |
| `packages/util/src/error.ts` | 60 | 0 | 0 | 0 |
| `packages/util/src/fn.ts` | 12 | 1 | 0 | 0 |
| `packages/util/src/identifier.ts` | 68 | 5 | 0 | 0 |
| `packages/util/src/iife.ts` | 4 | 1 | 0 | 0 |
| `packages/util/src/lazy.ts` | 15 | 1 | 0 | 0 |
| `packages/util/src/module.ts` | 11 | 2 | 1 | 0 |
| `packages/util/src/path.ts` | 40 | 5 | 0 | 0 |
| `packages/util/src/retry.ts` | 42 | 2 | 0 | 0 |
| `packages/util/src/slug.ts` | 75 | 2 | 0 | 0 |
| `packages/util/sst-env.d.ts` | 10 | 0 | 0 | 0 |

### Exports (sample)
- `findLast@packages/util/src/array.ts:1`
- `Binary@packages/util/src/binary.ts:1`
- `search@packages/util/src/binary.ts:2`
- `insert@packages/util/src/binary.ts:22`
- `base64Encode@packages/util/src/encode.ts:1`
- `base64Decode@packages/util/src/encode.ts:7`
- `hash@packages/util/src/encode.ts:14`
- `checksum@packages/util/src/encode.ts:23`
- `sampledChecksum@packages/util/src/encode.ts:33`
- `fn@packages/util/src/fn.ts:3`
- `BASE62_ALPHABET@packages/util/src/identifier.ts:3`
- `Identifier@packages/util/src/identifier.ts:5`
- `ascending@packages/util/src/identifier.ts:13`
- `descending@packages/util/src/identifier.ts:17`
- `create@packages/util/src/identifier.ts:40`
- `iife@packages/util/src/iife.ts:1`
- `lazy@packages/util/src/lazy.ts:1`
- `Module@packages/util/src/module.ts:4`
- `resolve@packages/util/src/module.ts:5`
- `getFilename@packages/util/src/path.ts:1`

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
| Module contract | public exports (28) | static map |
| Silent failure | empty catch (1) | per-site disposition in findings |
| Secrets/process/IO | risk tags quality | hotspot scan |

## 3–7. Protocol steps 3–7

Completed by dual-agent; see agent-protocol.json

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-pkg-util-empty-catch | silent-error | Low | new | deferred |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `b0f9b1558ec9a05c` |
| Dual-agent protocol | complete |
| Critical independent verify | ax-code-glm |

### Exit checklist
- [x] Full 9-step protocol by dual-agent/implementer
- [x] Map with unit-scoped files (XL filters applied when configured)
- [x] Findings ledger consistent with findings/ files
- [x] Sign-off roles complete

### Sign-off

| Role | Name | Date | Evidence |
|------|------|------|----------|
| Reviewer | codex-sol | 2026-08-11 | filesRead=27 |
| Independent verifier | ax-code-glm | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
