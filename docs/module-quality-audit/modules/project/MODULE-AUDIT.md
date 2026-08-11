# MODULE-AUDIT: project

| Field | Value |
|-------|-------|
| Unit slug | `project` |
| Scope | `packages/ax-code/src/project` |
| Resolved root | `packages/ax-code/src/project` |
| XL filter | no |
| Wave / effort | Wave 4 / M |
| Risk tags | persistence |
| Status | SIGNED OFF |
| Reviewer | implementer |
| Independent verifier | ax-code-glm |
| Baseline commit | `054002dd73198d659d505539f080200bdbc66bc8` |
| Analysis fingerprint | `42e396112a28cd14` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 8 / 1409 |
| Inventory ID | W4-04 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/project/bootstrap.ts` | 196 | 1 | 0 | 0 |
| `packages/ax-code/src/project/instance.ts` | 430 | 4 | 0 | 0 |
| `packages/ax-code/src/project/project-identity.ts` | 40 | 4 | 0 | 0 |
| `packages/ax-code/src/project/project.sql.ts` | 17 | 1 | 0 | 0 |
| `packages/ax-code/src/project/project.ts` | 505 | 18 | 0 | 0 |
| `packages/ax-code/src/project/schema.ts` | 11 | 2 | 0 | 0 |
| `packages/ax-code/src/project/state.ts` | 128 | 4 | 0 | 0 |
| `packages/ax-code/src/project/vcs.ts` | 82 | 6 | 0 | 0 |

### Exports (sample)
- `InstanceBootstrap@packages/ax-code/src/project/bootstrap.ts:79`
- `Shape@packages/ax-code/src/project/instance.ts:16`
- `Instance@packages/ax-code/src/project/instance.ts:196`
- `LifecycleKind@packages/ax-code/src/project/instance.ts:407`
- `LifecycleEvent@packages/ax-code/src/project/instance.ts:421`
- `ProjectIdentity@packages/ax-code/src/project/project-identity.ts:5`
- `WorktreeIdentity@packages/ax-code/src/project/project-identity.ts:6`
- `listWorktreeIdentities@packages/ax-code/src/project/project-identity.ts:11`
- `listDuplicateWorktreeIdentities@packages/ax-code/src/project/project-identity.ts:27`
- `ProjectTable@packages/ax-code/src/project/project.sql.ts:5`
- `Project@packages/ax-code/src/project/project.ts:18`
- `Info@packages/ax-code/src/project/project.ts:21`
- `Info@packages/ax-code/src/project/project.ts:49`
- `Event@packages/ax-code/src/project/project.ts:51`
- `fromRow@packages/ax-code/src/project/project.ts:99`
- `safe@packages/ax-code/src/project/project.ts:105`
- `UpdateInput@packages/ax-code/src/project/project.ts:109`
- `UpdateInput@packages/ax-code/src/project/project.ts:115`
- `fromDirectory@packages/ax-code/src/project/project.ts:442`
- `discover@packages/ax-code/src/project/project.ts:446`

### Tests
- `packages/ax-code/test/cli/session-clear-project.test.ts`
- `packages/ax-code/test/project/instance-context.test.ts`
- `packages/ax-code/test/project/migrate-global.test.ts`
- `packages/ax-code/test/project/project.test.ts`
- `packages/ax-code/test/project/state.test.ts`
- `packages/ax-code/test/project/vcs.test.ts`
- `packages/ax-code/test/project/worktree-remove.test.ts`
- `packages/ax-code/test/runtime/headless/projection.test.ts`
- `packages/ax-code/test/server/project-config.test.ts`
- `packages/ax-code/test/server/project-identity.test.ts`
- `packages/ax-code/test/server/project-init-git.test.ts`
- `packages/ax-code/test/tool/verify_project.test.ts`
- `packages/ax-code/test/workflow/projection.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (40) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags persistence | hotspot scan |

## 3–7. Protocol steps 3–7

Step 1: Mapped 8 source files; exports≈41
Step 2: Threat: secrets=0 files, processRisk=0 files, emptyCatch=0
Step 3: Correctness: read control flow for public surfaces; findings=none
Step 4: Performance: not hot-path; spot-checked
Step 5: Design: ownership vs ARCHITECTURE/PROJECT_BOUNDARIES for packages/ax-code/src/project
Step 6: Hygiene: empty=0; notes: clean
Step 7: Tests: see MODULE-AUDIT matched tests; regressions for verified-fixed findings
Step 8: Findings disposition complete in findings/
Step 9: Verification commands recorded in STATUS gates; protocol marker written

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `42e396112a28cd14` |
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
| Reviewer | implementer | 2026-08-11 | filesRead=8 |
| Independent verifier | ax-code-glm | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
