# MODULE-AUDIT: control-plane

| Field | Value |
|-------|-------|
| Unit slug | `control-plane` |
| Scope | `packages/ax-code/src/control-plane` |
| Resolved root | `packages/ax-code/src/control-plane` |
| XL filter | no |
| Wave / effort | Wave 1 / L |
| Risk tags | security, concurrency |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `ad9a854c3f8f6cc3ffc48c356a2546d3f23e9945` |
| Analysis fingerprint | `d8d09c42fc0f90e4` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 17 / 2361 |
| Inventory ID | W1-09 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/control-plane/abort.ts` | 29 | 1 | 0 | 0 |
| `packages/ax-code/src/control-plane/adaptors.ts` | 16 | 3 | 0 | 0 |
| `packages/ax-code/src/control-plane/agent-control-events.ts` | 194 | 10 | 0 | 0 |
| `packages/ax-code/src/control-plane/agent-control-summary.ts` | 115 | 4 | 0 | 0 |
| `packages/ax-code/src/control-plane/agent-control.ts` | 339 | 32 | 0 | 0 |
| `packages/ax-code/src/control-plane/autonomous-completion-gate.ts` | 409 | 6 | 0 | 0 |
| `packages/ax-code/src/control-plane/execution-controller.ts` | 117 | 5 | 0 | 0 |
| `packages/ax-code/src/control-plane/reasoning-policy.ts` | 272 | 9 | 0 | 0 |
| `packages/ax-code/src/control-plane/safety-policy.ts` | 241 | 12 | 0 | 0 |
| `packages/ax-code/src/control-plane/schema.ts` | 6 | 2 | 0 | 0 |
| `packages/ax-code/src/control-plane/sse.ts` | 139 | 4 | 0 | 0 |
| `packages/ax-code/src/control-plane/types.ts` | 7 | 1 | 0 | 0 |
| `packages/ax-code/src/control-plane/workspace-context.ts` | 16 | 3 | 0 | 0 |
| `packages/ax-code/src/control-plane/workspace-router-middleware.ts` | 134 | 1 | 0 | 0 |
| `packages/ax-code/src/control-plane/workspace-server/server.ts` | 112 | 3 | 0 | 0 |
| `packages/ax-code/src/control-plane/workspace.sql.ts` | 33 | 1 | 0 | 0 |
| `packages/ax-code/src/control-plane/workspace.ts` | 182 | 8 | 0 | 0 |

### Exports (sample)
- `waitForAbortOrTimeout@packages/ax-code/src/control-plane/abort.ts:1`
- `installAdaptor@packages/ax-code/src/control-plane/adaptors.ts:5`
- `getAdaptor@packages/ax-code/src/control-plane/adaptors.ts:9`
- `removeAdaptor@packages/ax-code/src/control-plane/adaptors.ts:13`
- `AgentControlEvents@packages/ax-code/src/control-plane/agent-control-events.ts:6`
- `phaseChanged@packages/ax-code/src/control-plane/agent-control-events.ts:14`
- `reasoningSelected@packages/ax-code/src/control-plane/agent-control-events.ts:33`
- `planCreated@packages/ax-code/src/control-plane/agent-control-events.ts:54`
- `planUpdated@packages/ax-code/src/control-plane/agent-control-events.ts:69`
- `validationUpdated@packages/ax-code/src/control-plane/agent-control-events.ts:86`
- `blocked@packages/ax-code/src/control-plane/agent-control-events.ts:103`
- `completionGateDecided@packages/ax-code/src/control-plane/agent-control-events.ts:122`
- `completed@packages/ax-code/src/control-plane/agent-control-events.ts:145`
- `safetyDecided@packages/ax-code/src/control-plane/agent-control-events.ts:163`
- `AgentControlSummary@packages/ax-code/src/control-plane/agent-control-summary.ts:5`
- `Summary@packages/ax-code/src/control-plane/agent-control-summary.ts:6`
- `fromEvents@packages/ax-code/src/control-plane/agent-control-summary.ts:33`
- `statusLine@packages/ax-code/src/control-plane/agent-control-summary.ts:97`
- `AgentControl@packages/ax-code/src/control-plane/agent-control.ts:3`
- `Phase@packages/ax-code/src/control-plane/agent-control.ts:4`

### Tests
- `packages/ax-code/test/cli/tui/agent-control-activity.test.ts`
- `packages/ax-code/test/cli/tui/sync-bootstrap-controller.test.ts`
- `packages/ax-code/test/control-plane/abort.test.ts`
- `packages/ax-code/test/control-plane/agent-control-events.test.ts`
- `packages/ax-code/test/control-plane/agent-control-summary.test.ts`
- `packages/ax-code/test/control-plane/agent-control.test.ts`
- `packages/ax-code/test/control-plane/autonomous-completion-gate.test.ts`
- `packages/ax-code/test/control-plane/execution-controller.test.ts`
- `packages/ax-code/test/control-plane/safety-policy.test.ts`
- `packages/ax-code/test/control-plane/session-proxy-middleware.test.ts`
- `packages/ax-code/test/control-plane/sse.test.ts`
- `packages/ax-code/test/control-plane/workspace-recovery.test.ts`
- `packages/ax-code/test/control-plane/workspace-remove.test.ts`
- `packages/ax-code/test/control-plane/workspace-server-sse.test.ts`
- `packages/ax-code/test/control-plane/workspace-sync.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (105) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags security,concurrency | hotspot scan |

## 3–7. Protocol steps 3–7

Completed by dual-agent; see agent-protocol.json

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `d8d09c42fc0f90e4` |
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
| Reviewer | codex-sol | 2026-08-11 | filesRead=28 |
| Independent verifier | ax-code-glm | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
