# MODULE-AUDIT: server-routes-app-context-templates

| Field | Value |
|-------|-------|
| Unit slug | `server-routes-app-context-templates` |
| Scope | `packages/ax-code/src/server/routes/app-context-templates.ts` |
| Resolved root | `packages/ax-code/src/server/routes/app-context-templates.ts` |
| XL filter | no |
| Wave / effort | Wave 4 / S |
| Risk tags | network, api |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `5fefa00cdc847667d3ba3d38509a751498ee4180` |
| Analysis fingerprint | `6d7299ae7f540cea` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 1 / 118 |
| Inventory ID | W4-03-03 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/server/routes/app-context-templates.ts` | 118 | 2 | 0 | 0 |

### Exports (sample)
- `contextTemplates@packages/ax-code/src/server/routes/app-context-templates.ts:8`
- `templateBody@packages/ax-code/src/server/routes/app-context-templates.ts:53`

### Tests
- `packages/ax-code/test/cli/cmd/tui/routes/session/autonomous-active.test.ts`
- `packages/ax-code/test/cli/cmd/tui/routes/session/coalesce.test.ts`
- `packages/ax-code/test/cli/cmd/tui/routes/session/footer-view-model.test.ts`
- `packages/ax-code/test/cli/cmd/tui/routes/session/format.test.ts`
- `packages/ax-code/test/cli/github-agent-run-context.test.ts`
- `packages/ax-code/test/cli/tui/context-kv-race.test.ts`
- `packages/ax-code/test/code-intelligence/graph-context.test.ts`
- `packages/ax-code/test/context/analyzer.test.ts`
- `packages/ax-code/test/context/generator.test.ts`
- `packages/ax-code/test/context/long-agent-packer.test.ts`
- `packages/ax-code/test/control-plane/workspace-server-sse.test.ts`
- `packages/ax-code/test/lsp/server-config.test.ts`
- `packages/ax-code/test/lsp/server-defs.test.ts`
- `packages/ax-code/test/lsp/server-helpers.test.ts`
- `packages/ax-code/test/lsp/server-profile.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (2) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags network,api | hotspot scan |

## 3–7. Protocol steps 3–7

Completed by dual-agent; see agent-protocol.json

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `6d7299ae7f540cea` |
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
| Reviewer | ax-code-glm | 2026-08-11 | filesRead=5 |
| Independent verifier | codex-sol | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
