# MODULE-AUDIT: lsp

| Field | Value |
|-------|-------|
| Unit slug | `lsp` |
| Scope | `packages/ax-code/src/lsp` |
| Resolved root | `packages/ax-code/src/lsp` |
| XL filter | no |
| Wave / effort | Wave 5 / L |
| Risk tags | performance, process |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `cab6c0089e3b7b3410f050bc9d824c06a3c3a814` |
| Analysis fingerprint | `fd543bec806ec41d` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 34 / 6329 |
| Inventory ID | W5-06 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/lsp/broken-server.ts` | 61 | 4 | 0 | 0 |
| `packages/ax-code/src/lsp/cache-probe.ts` | 97 | 4 | 0 | 0 |
| `packages/ax-code/src/lsp/cache.ts` | 162 | 8 | 0 | 0 |
| `packages/ax-code/src/lsp/client-notify.ts` | 48 | 2 | 0 | 0 |
| `packages/ax-code/src/lsp/client.ts` | 706 | 10 | 0 | 0 |
| `packages/ax-code/src/lsp/diagnostics.ts` | 147 | 9 | 0 | 0 |
| `packages/ax-code/src/lsp/document-symbol.ts` | 74 | 4 | 0 | 0 |
| `packages/ax-code/src/lsp/envelope-runner.ts` | 132 | 3 | 0 | 0 |
| `packages/ax-code/src/lsp/envelope.ts` | 38 | 4 | 0 | 0 |
| `packages/ax-code/src/lsp/index-impl.ts` | 967 | 55 | 0 | 0 |
| `packages/ax-code/src/lsp/index.ts` | 2 | 0 | 0 | 0 |
| `packages/ax-code/src/lsp/jdtls-data-dir.ts` | 33 | 4 | 0 | 0 |
| `packages/ax-code/src/lsp/language.ts` | 122 | 1 | 0 | 0 |
| `packages/ax-code/src/lsp/launch.ts` | 49 | 3 | 0 | 0 |
| `packages/ax-code/src/lsp/oxlint.ts` | 58 | 2 | 0 | 0 |
| `packages/ax-code/src/lsp/perf.ts` | 105 | 6 | 0 | 0 |
| `packages/ax-code/src/lsp/point.ts` | 269 | 21 | 0 | 0 |
| `packages/ax-code/src/lsp/prewarm-profile.ts` | 15 | 6 | 0 | 0 |
| `packages/ax-code/src/lsp/prewarm.ts` | 35 | 2 | 0 | 0 |
| `packages/ax-code/src/lsp/protocol.ts` | 45 | 6 | 0 | 0 |
| `packages/ax-code/src/lsp/references.ts` | 62 | 3 | 0 | 0 |
| `packages/ax-code/src/lsp/scheduler.ts` | 230 | 10 | 0 | 0 |
| `packages/ax-code/src/lsp/selection.ts` | 128 | 16 | 0 | 0 |
| `packages/ax-code/src/lsp/server-config.ts` | 116 | 3 | 0 | 0 |
| `packages/ax-code/src/lsp/server-defs/index.ts` | 23 | 0 | 0 | 0 |
| `packages/ax-code/src/lsp/server-defs/jvm-llvm-servers.ts` | 577 | 12 | 0 | 0 |
| `packages/ax-code/src/lsp/server-defs/other-servers.ts` | 232 | 10 | 0 | 0 |
| `packages/ax-code/src/lsp/server-defs/shared.ts` | 76 | 11 | 0 | 0 |
| `packages/ax-code/src/lsp/server-defs/web-servers.ts` | 407 | 17 | 0 | 0 |
| `packages/ax-code/src/lsp/server-helpers.ts` | 387 | 29 | 0 | 0 |

### Exports (sample)
- `BrokenEntry@packages/ax-code/src/lsp/broken-server.ts:14`
- `computeBackoff@packages/ax-code/src/lsp/broken-server.ts:19`
- `isBroken@packages/ax-code/src/lsp/broken-server.ts:25`
- `markBroken@packages/ax-code/src/lsp/broken-server.ts:48`
- `CacheProbeInput@packages/ax-code/src/lsp/cache-probe.ts:7`
- `read@packages/ax-code/src/lsp/cache-probe.ts:22`
- `hashAndRead@packages/ax-code/src/lsp/cache-probe.ts:35`
- `run@packages/ax-code/src/lsp/cache-probe.ts:46`
- `LSPCache@packages/ax-code/src/lsp/cache.ts:11`
- `Envelope@packages/ax-code/src/lsp/cache.ts:14`
- `WritableEnvelope@packages/ax-code/src/lsp/cache.ts:24`
- `enabled@packages/ax-code/src/lsp/cache.ts:59`
- `shouldWrite@packages/ax-code/src/lsp/cache.ts:63`
- `hashFile@packages/ax-code/src/lsp/cache.ts:67`
- `lookup@packages/ax-code/src/lsp/cache.ts:78`
- `write@packages/ax-code/src/lsp/cache.ts:117`
- `openAll@packages/ax-code/src/lsp/client-notify.ts:8`
- `closeAll@packages/ax-code/src/lsp/client-notify.ts:33`
- `LspContentChange@packages/ax-code/src/lsp/client.ts:50`
- `computeIncrementalChanges@packages/ax-code/src/lsp/client.ts:74`

### Tests
- `packages/ax-code/test/code-intelligence/lsp-cache.test.ts`
- `packages/ax-code/test/debug-engine/prewarm-lsp.test.ts`
- `packages/ax-code/test/lsp/cache-probe.test.ts`
- `packages/ax-code/test/lsp/cache.test.ts`
- `packages/ax-code/test/lsp/call-hierarchy.test.ts`
- `packages/ax-code/test/lsp/client-cap.test.ts`
- `packages/ax-code/test/lsp/client-notify.test.ts`
- `packages/ax-code/test/lsp/client.test.ts`
- `packages/ax-code/test/lsp/diagnostics-aggregated.test.ts`
- `packages/ax-code/test/lsp/document-symbol.test.ts`
- `packages/ax-code/test/lsp/envelope-coverage.test.ts`
- `packages/ax-code/test/lsp/envelope-freshness.test.ts`
- `packages/ax-code/test/lsp/incremental.test.ts`
- `packages/ax-code/test/lsp/index.test.ts`
- `packages/ax-code/test/lsp/launch.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (353) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags performance,process | hotspot scan |

## 3–7. Protocol steps 3–7

Completed by dual-agent; see agent-protocol.json

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `fd543bec806ec41d` |
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
| Reviewer | codex-sol | 2026-08-11 | filesRead=43 |
| Independent verifier | ax-code-glm | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
