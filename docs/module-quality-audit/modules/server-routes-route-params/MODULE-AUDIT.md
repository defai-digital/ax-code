# MODULE-AUDIT: server-routes-route-params

| Field | Value |
|-------|-------|
| Unit slug | `server-routes-route-params` |
| Scope | `packages/ax-code/src/server/routes/route-params.ts` |
| Resolved root | `packages/ax-code/src/server/routes/route-params.ts` |
| XL filter | no |
| Wave / effort | Wave 4 / S |
| Risk tags | network, api |
| Status | REVIEWING |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `8a38b90b950855545c6b2479220274357904f111` |
| Analysis fingerprint | `5cb2288aa89f6cf5` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 1 / 75 |
| Inventory ID | W4-03-25 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/server/routes/route-params.ts` | 75 | 16 | 0 | 0 |

### Exports (sample)
- `SessionRouteContext@packages/ax-code/src/server/routes/route-params.ts:11`
- `parseSessionID@packages/ax-code/src/server/routes/route-params.ts:17`
- `SESSION_ID_PARAM@packages/ax-code/src/server/routes/route-params.ts:21`
- `PROVIDER_ID_PARAM@packages/ax-code/src/server/routes/route-params.ts:22`
- `PROJECT_ID_PARAM@packages/ax-code/src/server/routes/route-params.ts:25`
- `PTY_ID_PARAM@packages/ax-code/src/server/routes/route-params.ts:28`
- `QUESTION_REQUEST_ID_PARAM@packages/ax-code/src/server/routes/route-params.ts:31`
- `PERMISSION_REQUEST_ID_PARAM@packages/ax-code/src/server/routes/route-params.ts:34`
- `parseExistingSessionID@packages/ax-code/src/server/routes/route-params.ts:38`
- `withRouteParam@packages/ax-code/src/server/routes/route-params.ts:44`
- `withProviderID@packages/ax-code/src/server/routes/route-params.ts:52`
- `withProjectID@packages/ax-code/src/server/routes/route-params.ts:56`
- `withPtyID@packages/ax-code/src/server/routes/route-params.ts:60`
- `withSessionID@packages/ax-code/src/server/routes/route-params.ts:64`
- `withQuestionRequestID@packages/ax-code/src/server/routes/route-params.ts:68`
- `withPermissionRequestID@packages/ax-code/src/server/routes/route-params.ts:72`

### Tests
- `packages/ax-code/test/agent/router.test.ts`
- `packages/ax-code/test/cli/cmd/tui/routes/session/autonomous-active.test.ts`
- `packages/ax-code/test/cli/cmd/tui/routes/session/coalesce.test.ts`
- `packages/ax-code/test/cli/cmd/tui/routes/session/footer-view-model.test.ts`
- `packages/ax-code/test/cli/cmd/tui/routes/session/format.test.ts`
- `packages/ax-code/test/cli/tui/route-decode.test.ts`
- `packages/ax-code/test/cli/tui/session-route-fixes.test.ts`
- `packages/ax-code/test/cli/tui/session-route.test.ts`
- `packages/ax-code/test/control-plane/workspace-server-sse.test.ts`
- `packages/ax-code/test/lsp/server-config.test.ts`
- `packages/ax-code/test/lsp/server-defs.test.ts`
- `packages/ax-code/test/lsp/server-helpers.test.ts`
- `packages/ax-code/test/lsp/server-profile.test.ts`
- `packages/ax-code/test/perf/route-indicator-map.test.ts`
- `packages/ax-code/test/server/app-context-routes.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (16) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags network,api | hotspot scan |

## 3–7. Protocol steps 3–7

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `5cb2288aa89f6cf5` |
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
