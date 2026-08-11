# MODULE-AUDIT: cli-cmd-release

| Field | Value |
|-------|-------|
| Unit slug | `cli-cmd-release` |
| Scope | `packages/ax-code/src/cli/cmd/release` |
| Resolved root | `packages/ax-code/src/cli/cmd/release` |
| XL filter | no |
| Wave / effort | Wave 6 / M |
| Risk tags | cli |
| Status | REVIEWING |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `046510f0ca8a215f632e99fa92aa0633d684cbb9` |
| Analysis fingerprint | `de5a7524d4560157` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 2 / 818 |
| Inventory ID | W6-18 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/cli/cmd/release/check.ts` | 800 | 12 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/release/index.ts` | 18 | 1 | 0 | 0 |

### Exports (sample)
- `ReleaseCheckStatus@packages/ax-code/src/cli/cmd/release/check.ts:29`
- `ReleaseCheckResult@packages/ax-code/src/cli/cmd/release/check.ts:31`
- `releaseReadinessChecks@packages/ax-code/src/cli/cmd/release/check.ts:43`
- `PackageJSON@packages/ax-code/src/cli/cmd/release/check.ts:78`
- `decodeReleasePackageJsonValue@packages/ax-code/src/cli/cmd/release/check.ts:83`
- `parseReleasePackageJsonText@packages/ax-code/src/cli/cmd/release/check.ts:91`
- `CheckStatus@packages/ax-code/src/cli/cmd/release/check.ts:121`
- `CheckResult@packages/ax-code/src/cli/cmd/release/check.ts:123`
- `CheckContext@packages/ax-code/src/cli/cmd/release/check.ts:132`
- `CHECK_IDS@packages/ax-code/src/cli/cmd/release/check.ts:661`
- `runChecks@packages/ax-code/src/cli/cmd/release/check.ts:663`
- `ReleaseCheckCommand@packages/ax-code/src/cli/cmd/release/check.ts:728`
- `ReleaseCommand@packages/ax-code/src/cli/cmd/release/index.ts:12`

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
| Module contract | public exports (13) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags cli | hotspot scan |

## 3–7. Protocol steps 3–7

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `de5a7524d4560157` |
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
