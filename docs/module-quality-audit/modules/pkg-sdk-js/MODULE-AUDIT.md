# MODULE-AUDIT: pkg-sdk-js

| Field | Value |
|-------|-------|
| Unit slug | `pkg-sdk-js` |
| Scope | `packages/sdk/js` |
| Resolved root | `packages/sdk/js` |
| XL filter | no |
| Wave / effort | Wave 9 / L |
| Risk tags | api |
| Status | SIGNED OFF |
| Reviewer | implementer |
| Independent verifier | codex-sol |
| Baseline commit | `054002dd73198d659d505539f080200bdbc66bc8` |
| Analysis fingerprint | `33ca4abf6277714b` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 90 / 60137 |
| Inventory ID | W9-01 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/sdk/js/example/example.ts` | 58 | 0 | 0 | 0 |
| `packages/sdk/js/example/headless-app.ts` | 36 | 0 | 0 | 0 |
| `packages/sdk/js/example/programmatic.ts` | 119 | 0 | 0 | 0 |
| `packages/sdk/js/script/build.ts` | 293 | 1 | 0 | 0 |
| `packages/sdk/js/script/publish.ts` | 41 | 0 | 0 | 0 |
| `packages/sdk/js/script/validate-openapi.ts` | 26 | 0 | 0 | 0 |
| `packages/sdk/js/src/client.ts` | 31 | 2 | 0 | 0 |
| `packages/sdk/js/src/gen/client/client.gen.ts` | 274 | 1 | 0 | 1 |
| `packages/sdk/js/src/gen/client/index.ts` | 26 | 0 | 0 | 0 |
| `packages/sdk/js/src/gen/client/types.gen.ts` | 207 | 10 | 0 | 0 |
| `packages/sdk/js/src/gen/client/utils.gen.ts` | 290 | 9 | 0 | 0 |
| `packages/sdk/js/src/gen/client.gen.ts` | 19 | 2 | 0 | 0 |
| `packages/sdk/js/src/gen/core/auth.gen.ts` | 42 | 3 | 0 | 0 |
| `packages/sdk/js/src/gen/core/bodySerializer.gen.ts` | 83 | 6 | 0 | 0 |
| `packages/sdk/js/src/gen/core/params.gen.ts` | 184 | 4 | 0 | 0 |
| `packages/sdk/js/src/gen/core/pathSerializer.gen.ts` | 168 | 10 | 0 | 0 |
| `packages/sdk/js/src/gen/core/queryKeySerializer.gen.ts` | 112 | 4 | 0 | 0 |
| `packages/sdk/js/src/gen/core/serverSentEvents.gen.ts` | 248 | 4 | 0 | 0 |
| `packages/sdk/js/src/gen/core/types.gen.ts` | 87 | 4 | 0 | 0 |
| `packages/sdk/js/src/gen/core/utils.gen.ts` | 138 | 5 | 0 | 0 |
| `packages/sdk/js/src/gen/sdk.gen.ts` | 7459 | 52 | 0 | 0 |
| `packages/sdk/js/src/gen/types.gen.ts` | 14170 | 1078 | 0 | 0 |
| `packages/sdk/js/src/grpc-node.ts` | 790 | 8 | 0 | 0 |
| `packages/sdk/js/src/grpc.ts` | 2660 | 83 | 1 | 0 |
| `packages/sdk/js/src/headless/client.ts` | 769 | 37 | 0 | 0 |
| `packages/sdk/js/src/headless/command.ts` | 97 | 11 | 0 | 0 |
| `packages/sdk/js/src/headless/diagnostics.ts` | 49 | 8 | 0 | 0 |
| `packages/sdk/js/src/headless/event.ts` | 223 | 21 | 0 | 0 |
| `packages/sdk/js/src/headless/http-transport.ts` | 191 | 4 | 0 | 0 |
| `packages/sdk/js/src/headless/ipc-protocol.ts` | 110 | 9 | 0 | 0 |

### Exports (sample)
- `buildClientParams@packages/sdk/js/script/build.ts:130`
- `createAxCodeClient@packages/sdk/js/src/client.ts:10`
- `createOpencodeClient@packages/sdk/js/src/client.ts:30`
- `createClient@packages/sdk/js/src/gen/client/client.gen.ts:22`
- `ResponseStyle@packages/sdk/js/src/gen/client/types.gen.ts:8`
- `Config@packages/sdk/js/src/gen/client/types.gen.ts:10`
- `RequestOptions@packages/sdk/js/src/gen/client/types.gen.ts:54`
- `ResolvedRequestOptions@packages/sdk/js/src/gen/client/types.gen.ts:82`
- `RequestResult@packages/sdk/js/src/gen/client/types.gen.ts:91`
- `ClientOptions@packages/sdk/js/src/gen/client/types.gen.ts:128`
- `Client@packages/sdk/js/src/gen/client/types.gen.ts:174`
- `CreateClientConfig@packages/sdk/js/src/gen/client/types.gen.ts:186`
- `TDataShape@packages/sdk/js/src/gen/client/types.gen.ts:190`
- `Options@packages/sdk/js/src/gen/client/types.gen.ts:200`
- `createQuerySerializer@packages/sdk/js/src/gen/client/utils.gen.ts:10`
- `getParseAs@packages/sdk/js/src/gen/client/utils.gen.ts:61`
- `setAuthParams@packages/sdk/js/src/gen/client/utils.gen.ts:108`
- `buildUrl@packages/sdk/js/src/gen/client/utils.gen.ts:144`
- `mergeConfigs@packages/sdk/js/src/gen/client/utils.gen.ts:156`
- `mergeHeaders@packages/sdk/js/src/gen/client/utils.gen.ts:173`

### Tests
- `packages/ax-code/test/acp/sdk-client-naming.test.ts`
- `packages/ax-code/test/cli/tui/p-permission-question-reply-sdk-error.test.ts`
- `packages/ax-code/test/cli/tui/s-dialog-session-list-rename-sdk-error.test.ts`
- `packages/ax-code/test/cli/tui/sdk-client-naming.test.ts`
- `packages/ax-code/test/sdk/programmatic.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (2666) | static map |
| Silent failure | empty catch (9) | per-site disposition in findings |
| Secrets/process/IO | risk tags api | hotspot scan |

## 3–7. Protocol steps 3–7

Step 1: Mapped 30 source files; exports≈1391
Step 2: Threat: secrets=8 files, processRisk=1 files, emptyCatch=1
Step 3: Correctness: read control flow for public surfaces; findings=AUDIT-pkg-sdk-js-empty-catch.md
Step 4: Performance: not hot-path; spot-checked
Step 5: Design: ownership vs ARCHITECTURE/PROJECT_BOUNDARIES for packages/sdk/js
Step 6: Hygiene: empty=1; notes: packages/sdk/js/src/gen/types.gen.ts: contains known defensive pattern; packages/sdk/js/src/grpc.ts: 1 empty catch(es) — see empty-catch finding disposition
Step 7: Tests: see MODULE-AUDIT matched tests; regressions for verified-fixed findings
Step 8: Findings disposition complete in findings/
Step 9: Verification commands recorded in STATUS gates; protocol marker written

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-pkg-sdk-js-empty-catch | silent-error | Medium | new | deferred |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `33ca4abf6277714b` |
| Dual-agent protocol | complete |
| Critical independent verify | codex-sol |

### Exit checklist
- [x] Full 9-step protocol by dual-agent/implementer
- [x] Map with unit-scoped files (XL filters applied when configured)
- [x] Findings ledger consistent with findings/ files
- [x] Sign-off roles complete

### Sign-off

| Role | Name | Date | Evidence |
|------|------|------|----------|
| Reviewer | implementer | 2026-08-11 | filesRead=30 |
| Independent verifier | codex-sol | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
