# MODULE-AUDIT: cli-cmd-doctor

| Field | Value |
|-------|-------|
| Unit slug | `cli-cmd-doctor` |
| Scope | `packages/ax-code/src/cli/cmd/doctor` |
| Resolved root | `packages/ax-code/src/cli/cmd/doctor.ts` |
| XL filter | no |
| Wave / effort | Wave 6 / M |
| Risk tags | cli |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `5fefa00cdc847667d3ba3d38509a751498ee4180` |
| Analysis fingerprint | `9ed76eafe61b0849` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 1 / 553 |
| Inventory ID | W6-14 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/cli/cmd/doctor.ts` | 553 | 7 | 0 | 0 |

### Exports (sample)
- `getRuntimeCheck@packages/ax-code/src/cli/cmd/doctor.ts:38`
- `getServerExposureCheck@packages/ax-code/src/cli/cmd/doctor.ts:52`
- `getIsolationPolicyCheck@packages/ax-code/src/cli/cmd/doctor.ts:66`
- `getAxEngineDoctorCheck@packages/ax-code/src/cli/cmd/doctor.ts:91`
- `getDuplicateProjectIdentityCheck@packages/ax-code/src/cli/cmd/doctor.ts:187`
- `doctorProjectContext@packages/ax-code/src/cli/cmd/doctor.ts:212`
- `DoctorCommand@packages/ax-code/src/cli/cmd/doctor.ts:233`

### Tests
- `packages/ax-code/test/acp/sdk-client-naming.test.ts`
- `packages/ax-code/test/cli/account.test.ts`
- `packages/ax-code/test/cli/acp.test.ts`
- `packages/ax-code/test/cli/agent.test.ts`
- `packages/ax-code/test/cli/audit.test.ts`
- `packages/ax-code/test/cli/boot.test.ts`
- `packages/ax-code/test/cli/bootstrap/windows-console.test.ts`
- `packages/ax-code/test/cli/capability.test.ts`
- `packages/ax-code/test/cli/cmd/tui/component/slash-frecency.test.ts`
- `packages/ax-code/test/cli/cmd/tui/prompt-part.test.ts`
- `packages/ax-code/test/cli/cmd/tui/routes/session/autonomous-active.test.ts`
- `packages/ax-code/test/cli/cmd/tui/routes/session/coalesce.test.ts`
- `packages/ax-code/test/cli/cmd/tui/routes/session/footer-view-model.test.ts`
- `packages/ax-code/test/cli/cmd/tui/routes/session/format.test.ts`
- `packages/ax-code/test/cli/cmd/tui/ui/glyphs.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (7) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags cli | hotspot scan |

## 3–7. Protocol steps 3–7

Completed by dual-agent; see agent-protocol.json

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `9ed76eafe61b0849` |
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
