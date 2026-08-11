# MODULE-AUDIT: image

| Field | Value |
|-------|-------|
| Unit slug | `image` |
| Scope | `packages/ax-code/src/image` |
| Resolved root | `packages/ax-code/src/image` |
| XL filter | no |
| Wave / effort | Wave 3 / M |
| Risk tags | security |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `994f9287e497666e104644eccea299595a35b39a` |
| Analysis fingerprint | `4c999a2fba6b7ae1` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 2 / 218 |
| Inventory ID | W3-13 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/image/index.ts` | 8 | 0 | 0 | 0 |
| `packages/ax-code/src/image/provider.ts` | 210 | 8 | 0 | 0 |

### Exports (sample)
- `ImageGenerateInput@packages/ax-code/src/image/provider.ts:6`
- `ImageGenerateOutput@packages/ax-code/src/image/provider.ts:13`
- `ImageProvider@packages/ax-code/src/image/provider.ts:18`
- `ImageProviderConfig@packages/ax-code/src/image/provider.ts:23`
- `OpenAIImageProvider@packages/ax-code/src/image/provider.ts:42`
- `StabilityImageProvider@packages/ax-code/src/image/provider.ts:93`
- `CustomImageProvider@packages/ax-code/src/image/provider.ts:133`
- `createImageProvider@packages/ax-code/src/image/provider.ts:192`

### Tests
- `packages/ax-code/test/image/provider.test.ts`
- `packages/ax-code/test/tool/image-gen.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (8) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags security | hotspot scan |

## 3–7. Protocol steps 3–7

Completed by dual-agent; see agent-protocol.json

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `4c999a2fba6b7ae1` |
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
| Reviewer | codex-sol | 2026-08-11 | filesRead=10 |
| Independent verifier | ax-code-glm | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
