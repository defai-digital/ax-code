# MODULE-AUDIT: server

| Field | Value |
|-------|-------|
| Unit slug | `server` |
| Scope | `packages/ax-code/src/server` |
| Resolved root | `packages/ax-code/src/server` |
| XL filter | no |
| Wave / effort | Wave 4 / L |
| Risk tags | security, network |
| Status | SIGNED OFF |
| Reviewer | implementer |
| Independent verifier | ax-code-glm |
| Baseline commit | `054002dd73198d659d505539f080200bdbc66bc8` |
| Analysis fingerprint | `d46619ad12c9665b` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 50 / 10261 |
| Inventory ID | W4-02 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/server/constants.ts` | 2 | 0 | 0 | 0 |
| `packages/ax-code/src/server/error.ts` | 366 | 11 | 0 | 0 |
| `packages/ax-code/src/server/event.ts` | 4 | 1 | 0 | 0 |
| `packages/ax-code/src/server/ipc-protocol.ts` | 95 | 9 | 0 | 0 |
| `packages/ax-code/src/server/ipc-transport.ts` | 343 | 4 | 1 | 0 |
| `packages/ax-code/src/server/listen-security.ts` | 8 | 0 | 0 | 0 |
| `packages/ax-code/src/server/mdns.ts` | 63 | 3 | 0 | 0 |
| `packages/ax-code/src/server/middleware.ts` | 104 | 3 | 0 | 0 |
| `packages/ax-code/src/server/request-directory.ts` | 71 | 1 | 0 | 0 |
| `packages/ax-code/src/server/routes/app-context-checks.ts` | 228 | 1 | 0 | 0 |
| `packages/ax-code/src/server/routes/app-context-schema.ts` | 52 | 7 | 0 | 0 |
| `packages/ax-code/src/server/routes/app-context-templates.ts` | 118 | 2 | 0 | 0 |
| `packages/ax-code/src/server/routes/app-context.ts` | 182 | 1 | 0 | 0 |
| `packages/ax-code/src/server/routes/app.ts` | 274 | 1 | 0 | 0 |
| `packages/ax-code/src/server/routes/audit.ts` | 159 | 3 | 0 | 0 |
| `packages/ax-code/src/server/routes/autonomous.ts` | 111 | 1 | 0 | 0 |
| `packages/ax-code/src/server/routes/config.ts` | 214 | 5 | 0 | 0 |
| `packages/ax-code/src/server/routes/dre-graph.ts` | 225 | 1 | 0 | 0 |
| `packages/ax-code/src/server/routes/event.ts` | 135 | 1 | 0 | 0 |
| `packages/ax-code/src/server/routes/experimental.ts` | 281 | 1 | 0 | 0 |
| `packages/ax-code/src/server/routes/file.ts` | 192 | 1 | 0 | 0 |
| `packages/ax-code/src/server/routes/global.ts` | 504 | 1 | 0 | 0 |
| `packages/ax-code/src/server/routes/graph.ts` | 90 | 1 | 0 | 0 |
| `packages/ax-code/src/server/routes/isolation.ts` | 122 | 1 | 0 | 0 |
| `packages/ax-code/src/server/routes/mcp.ts` | 306 | 1 | 0 | 0 |
| `packages/ax-code/src/server/routes/permission.ts` | 73 | 1 | 0 | 0 |
| `packages/ax-code/src/server/routes/project-config.ts` | 174 | 10 | 0 | 0 |
| `packages/ax-code/src/server/routes/project.ts` | 120 | 1 | 0 | 0 |
| `packages/ax-code/src/server/routes/prompt-history.ts` | 66 | 1 | 0 | 0 |
| `packages/ax-code/src/server/routes/provider.ts` | 728 | 6 | 0 | 0 |

### Exports (sample)
- `AppErrorEnvelope@packages/ax-code/src/server/error.ts:10`
- `AppErrorEnvelope@packages/ax-code/src/server/error.ts:24`
- `appErrorEnvelope@packages/ax-code/src/server/error.ts:242`
- `appErrorResponse@packages/ax-code/src/server/error.ts:256`
- `invalidRequest@packages/ax-code/src/server/error.ts:260`
- `notFound@packages/ax-code/src/server/error.ts:272`
- `forbidden@packages/ax-code/src/server/error.ts:281`
- `serviceUnavailable@packages/ax-code/src/server/error.ts:290`
- `rateLimited@packages/ax-code/src/server/error.ts:303`
- `ERRORS@packages/ax-code/src/server/error.ts:312`
- `errors@packages/ax-code/src/server/error.ts:363`
- `Event@packages/ax-code/src/server/event.ts:3`
- `IpcMessage@packages/ax-code/src/server/ipc-protocol.ts:4`
- `IpcRequestMessage@packages/ax-code/src/server/ipc-protocol.ts:6`
- `IpcResponseMessage@packages/ax-code/src/server/ipc-protocol.ts:17`
- `IpcErrorMessage@packages/ax-code/src/server/ipc-protocol.ts:24`
- `IpcEventMessage@packages/ax-code/src/server/ipc-protocol.ts:32`
- `IpcFrame@packages/ax-code/src/server/ipc-protocol.ts:37`
- `encodeIpcMessage@packages/ax-code/src/server/ipc-protocol.ts:39`
- `decodeIpcFrames@packages/ax-code/src/server/ipc-protocol.ts:47`

### Tests
- `packages/ax-code/test/control-plane/workspace-server-sse.test.ts`
- `packages/ax-code/test/lsp/server-config.test.ts`
- `packages/ax-code/test/lsp/server-defs.test.ts`
- `packages/ax-code/test/lsp/server-helpers.test.ts`
- `packages/ax-code/test/lsp/server-profile.test.ts`
- `packages/ax-code/test/server/app-context-routes.test.ts`
- `packages/ax-code/test/server/audit-route.test.ts`
- `packages/ax-code/test/server/capability.test.ts`
- `packages/ax-code/test/server/dre-graph.test.ts`
- `packages/ax-code/test/server/file-routes.test.ts`
- `packages/ax-code/test/server/global-capabilities.test.ts`
- `packages/ax-code/test/server/global-config.test.ts`
- `packages/ax-code/test/server/global-session-list.test.ts`
- `packages/ax-code/test/server/ipc-transport.test.ts`
- `packages/ax-code/test/server/isolation.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (135) | static map |
| Silent failure | empty catch (2) | per-site disposition in findings |
| Secrets/process/IO | risk tags security,network | hotspot scan |

## 3–7. Protocol steps 3–7

Step 1: Mapped 30 source files; exports≈85
Step 2: Threat: secrets=6 files, processRisk=0 files, emptyCatch=1
Step 3: Correctness: read control flow for public surfaces; findings=AUDIT-server-empty-catch.md
Step 4: Performance: not hot-path; spot-checked
Step 5: Design: ownership vs ARCHITECTURE/PROJECT_BOUNDARIES for packages/ax-code/src/server
Step 6: Hygiene: empty=1; notes: packages/ax-code/src/server/ipc-transport.ts: 1 empty catch(es) — see empty-catch finding disposition
Step 7: Tests: see MODULE-AUDIT matched tests; regressions for verified-fixed findings
Step 8: Findings disposition complete in findings/
Step 9: Verification commands recorded in STATUS gates; protocol marker written

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-server-empty-catch | silent-error | Low | new | deferred |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `d46619ad12c9665b` |
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
| Reviewer | implementer | 2026-08-11 | filesRead=30 |
| Independent verifier | ax-code-glm | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
