# MODULE-AUDIT: hooks

| Field | Value |
|-------|-------|
| Unit slug | `hooks` |
| Scope | `packages/ax-code/src/hooks` |
| Resolved root | `packages/ax-code/src/hooks` |
| XL filter | no |
| Wave / effort | Wave 1 / M |
| Risk tags | security, trust |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `994f9287e497666e104644eccea299595a35b39a` |
| Analysis fingerprint | `a0dee829f5423c8a` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 1 / 350 |
| Inventory ID | W1-04 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/hooks/lifecycle.ts` | 350 | 15 | 0 | 0 |

### Exports (sample)
- `LifecycleHooks@packages/ax-code/src/hooks/lifecycle.ts:24`
- `EventName@packages/ax-code/src/hooks/lifecycle.ts:69`
- `HookCommand@packages/ax-code/src/hooks/lifecycle.ts:70`
- `Pack@packages/ax-code/src/hooks/lifecycle.ts:77`
- `RunInput@packages/ax-code/src/hooks/lifecycle.ts:83`
- `RunResult@packages/ax-code/src/hooks/lifecycle.ts:91`
- `listBuiltinPacks@packages/ax-code/src/hooks/lifecycle.ts:161`
- `matcherHits@packages/ax-code/src/hooks/lifecycle.ts:165`
- `selectHooks@packages/ax-code/src/hooks/lifecycle.ts:178`
- `loadProjectHooks@packages/ax-code/src/hooks/lifecycle.ts:182`
- `resolveHooks@packages/ax-code/src/hooks/lifecycle.ts:207`
- `runHooks@packages/ax-code/src/hooks/lifecycle.ts:302`
- `runForWorkspace@packages/ax-code/src/hooks/lifecycle.ts:320`
- `packCatalogMarkdown@packages/ax-code/src/hooks/lifecycle.ts:326`
- `globalHooksDir@packages/ax-code/src/hooks/lifecycle.ts:346`

### Tests
- `packages/ax-code/test/hooks/lifecycle.test.ts`
- `packages/ax-code/test/session/prompt-loop-result-stop-hooks.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (15) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags security,trust | hotspot scan |

## 3–7. Protocol steps 3–7

Completed by dual-agent; see agent-protocol.json

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-hooks-001 | security | Critical | prior/new | verified-fixed |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `a0dee829f5423c8a` |
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
