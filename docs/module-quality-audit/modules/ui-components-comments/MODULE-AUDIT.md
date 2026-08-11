# MODULE-AUDIT: ui-components-comments

| Field | Value |
|-------|-------|
| Unit slug | `ui-components-comments` |
| Scope | `desktop/packages/ui/src/components/comments` |
| Resolved root | `desktop/packages/ui/src/components/comments` |
| XL filter | no |
| Wave / effort | Wave 8 / S |
| Risk tags | desktop, ui |
| Status | REVIEWING |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `94e95c161c7deb8e055d8806a5f285e516285715` |
| Analysis fingerprint | `e2897a3f70d0ce93` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 7 / 895 |
| Inventory ID | W8-03-03 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/ui/src/components/comments/CodeMirrorCommentWidgets.tsx` | 106 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/comments/InlineCommentCard.tsx` | 111 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/comments/InlineCommentInput.tsx` | 183 | 2 | 0 | 0 |
| `desktop/packages/ui/src/components/comments/PierreDiffCommentOverlays.tsx` | 233 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/comments/PierreDiffCommentUtils.ts` | 58 | 3 | 0 | 0 |
| `desktop/packages/ui/src/components/comments/index.ts` | 7 | 0 | 0 | 0 |
| `desktop/packages/ui/src/components/comments/useInlineCommentController.ts` | 197 | 3 | 0 | 0 |

### Exports (sample)
- `buildCodeMirrorCommentWidgets@desktop/packages/ui/src/components/comments/CodeMirrorCommentWidgets.tsx:27`
- `InlineCommentCard@desktop/packages/ui/src/components/comments/InlineCommentCard.tsx:19`
- `InlineCommentInputProps@desktop/packages/ui/src/components/comments/InlineCommentInput.tsx:9`
- `InlineCommentInput@desktop/packages/ui/src/components/comments/InlineCommentInput.tsx:20`
- `PierreDiffCommentOverlays@desktop/packages/ui/src/components/comments/PierreDiffCommentOverlays.tsx:44`
- `PierreAnnotationData@desktop/packages/ui/src/components/comments/PierreDiffCommentUtils.ts:4`
- `toPierreAnnotationId@desktop/packages/ui/src/components/comments/PierreDiffCommentUtils.ts:8`
- `buildPierreLineAnnotations@desktop/packages/ui/src/components/comments/PierreDiffCommentUtils.ts:25`
- `LineRange@desktop/packages/ui/src/components/comments/useInlineCommentController.ts:12`
- `normalizeLineRange@desktop/packages/ui/src/components/comments/useInlineCommentController.ts:42`
- `useInlineCommentController@desktop/packages/ui/src/components/comments/useInlineCommentController.ts:52`

### Tests
- none auto-matched

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (11) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags desktop,ui | hotspot scan |

## 3–7. Protocol steps 3–7

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `e2897a3f70d0ce93` |
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
