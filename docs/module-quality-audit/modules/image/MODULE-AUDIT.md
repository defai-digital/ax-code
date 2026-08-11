# MODULE-AUDIT: image

| Field | Value |
|-------|-------|
| Unit slug | `image` |
| Scope | `packages/ax-code/src/image` |
| Resolved root | `packages/ax-code/src/image` |
| XL filter | no |
| Wave / effort | Wave 3 / M |
| Risk tags | security |
| Status | REVIEWING |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `94e95c161c7deb8e055d8806a5f285e516285715` |
| Analysis fingerprint | `4c999a2fba6b7ae1` |
| Protocol marker | pending dual-agent 9-step |
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

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `4c999a2fba6b7ae1` |
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
