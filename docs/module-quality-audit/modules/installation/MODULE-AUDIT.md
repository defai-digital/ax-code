# MODULE-AUDIT: installation

| Field | Value |
|-------|-------|
| Unit slug | `installation` |
| Scope | `packages/ax-code/src/installation` |
| Resolved root | `packages/ax-code/src/installation` |
| XL filter | no |
| Wave / effort | Wave 1 / M |
| Risk tags | security, release |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8a38b90b950855545c6b2479220274357904f111` |
| Analysis fingerprint | `24e7ea928495b12b` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 2 / 446 |
| Inventory ID | W1-10 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/installation/index.ts` | 390 | 21 | 0 | 0 |
| `packages/ax-code/src/installation/runtime-mode.ts` | 56 | 4 | 0 | 0 |

### Exports (sample)
- `Installation@packages/ax-code/src/installation/index.ts:26`
- `Method@packages/ax-code/src/installation/index.ts:29`
- `ReleaseType@packages/ax-code/src/installation/index.ts:31`
- `Event@packages/ax-code/src/installation/index.ts:33`
- `compareVersions@packages/ax-code/src/installation/index.ts:48`
- `getReleaseType@packages/ax-code/src/installation/index.ts:53`
- `Info@packages/ax-code/src/installation/index.ts:68`
- `Info@packages/ax-code/src/installation/index.ts:76`
- `VERSION@packages/ax-code/src/installation/index.ts:79`
- `CHANNEL@packages/ax-code/src/installation/index.ts:87`
- `USER_AGENT@packages/ax-code/src/installation/index.ts:88`
- `isPreview@packages/ax-code/src/installation/index.ts:90`
- `isLocal@packages/ax-code/src/installation/index.ts:94`
- `UpgradeFailedError@packages/ax-code/src/installation/index.ts:98`
- `withDependencies@packages/ax-code/src/installation/index.ts:146`
- `info@packages/ax-code/src/installation/index.ts:259`
- `method@packages/ax-code/src/installation/index.ts:266`
- `latest@packages/ax-code/src/installation/index.ts:283`
- `upgrade@packages/ax-code/src/installation/index.ts:302`
- `LauncherCheck@packages/ax-code/src/installation/index.ts:369`

### Tests
- `packages/ax-code/test/installation/installation.test.ts`
- `packages/ax-code/test/installation/runtime-mode.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (25) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags security,release | hotspot scan |

## 3–7. Protocol steps 3–7

Completed by dual-agent; see agent-protocol.json

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `24e7ea928495b12b` |
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
| Reviewer | ax-code-glm | 2026-08-11 | filesRead=3 |
| Independent verifier | codex-sol | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
