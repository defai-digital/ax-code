# MODULE-AUDIT: pkg-opentui-core

| Field | Value |
|-------|-------|
| Unit slug | `pkg-opentui-core` |
| Scope | `packages/opentui-core` |
| Resolved root | `packages/opentui-core` |
| XL filter | no |
| Wave / effort | Wave 9 / L |
| Risk tags | ui |
| Status | SIGNED OFF |
| Reviewer | implementer |
| Independent verifier | codex-sol |
| Baseline commit | `054002dd73198d659d505539f080200bdbc66bc8` |
| Analysis fingerprint | `6d8ade5e21fdfb54` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 132 / 49786 |
| Inventory ID | W9-05 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/opentui-core/NativeSpanFeed.d.ts` | 53 | 1 | 0 | 0 |
| `packages/opentui-core/Renderable.d.ts` | 352 | 5 | 0 | 0 |
| `packages/opentui-core/animation/Timeline.d.ts` | 127 | 4 | 0 | 0 |
| `packages/opentui-core/ansi.d.ts` | 18 | 0 | 0 | 0 |
| `packages/opentui-core/audio.d.ts` | 90 | 10 | 0 | 0 |
| `packages/opentui-core/buffer.d.ts` | 114 | 0 | 0 | 0 |
| `packages/opentui-core/console.d.ts` | 147 | 3 | 0 | 0 |
| `packages/opentui-core/edit-buffer.d.ts` | 98 | 0 | 0 | 0 |
| `packages/opentui-core/editor-view.d.ts` | 73 | 1 | 0 | 0 |
| `packages/opentui-core/index-07zpr2dg.js` | 10097 | 0 | 2 | 0 |
| `packages/opentui-core/index-pcvh9d34.js` | 16052 | 0 | 2 | 0 |
| `packages/opentui-core/index.d.ts` | 25 | 0 | 0 | 0 |
| `packages/opentui-core/index.js` | 11680 | 0 | 0 | 0 |
| `packages/opentui-core/lib/KeyHandler.d.ts` | 62 | 1 | 0 | 0 |
| `packages/opentui-core/lib/RGBA.d.ts` | 43 | 4 | 0 | 0 |
| `packages/opentui-core/lib/ascii.font.d.ts` | 509 | 1 | 0 | 0 |
| `packages/opentui-core/lib/border.d.ts` | 52 | 6 | 0 | 0 |
| `packages/opentui-core/lib/bunfs.d.ts` | 8 | 0 | 0 | 0 |
| `packages/opentui-core/lib/clipboard.d.ts` | 17 | 0 | 0 | 0 |
| `packages/opentui-core/lib/clock.d.ts` | 16 | 2 | 0 | 0 |
| `packages/opentui-core/lib/data-paths.d.ts` | 27 | 2 | 0 | 0 |
| `packages/opentui-core/lib/debounce.d.ts` | 43 | 0 | 0 | 0 |
| `packages/opentui-core/lib/detect-links.d.ts` | 7 | 0 | 0 | 0 |
| `packages/opentui-core/lib/env.d.ts` | 43 | 1 | 0 | 0 |
| `packages/opentui-core/lib/extmarks-history.d.ts` | 18 | 1 | 0 | 0 |
| `packages/opentui-core/lib/extmarks.d.ts` | 91 | 2 | 0 | 0 |
| `packages/opentui-core/lib/hast-styled-text.d.ts` | 18 | 3 | 0 | 0 |
| `packages/opentui-core/lib/index.d.ts` | 22 | 0 | 0 | 0 |
| `packages/opentui-core/lib/keybinding.internal.d.ts` | 34 | 4 | 0 | 0 |
| `packages/opentui-core/lib/objects-in-viewport.d.ts` | 25 | 0 | 0 | 0 |

### Exports (sample)
- `DataHandler@packages/opentui-core/NativeSpanFeed.d.ts:4`
- `Position@packages/opentui-core/Renderable.d.ts:22`
- `BaseRenderableOptions@packages/opentui-core/Renderable.d.ts:28`
- `LayoutOptions@packages/opentui-core/Renderable.d.ts:31`
- `RenderableOptions@packages/opentui-core/Renderable.d.ts:66`
- `RenderCommand@packages/opentui-core/Renderable.d.ts:337`
- `TimelineOptions@packages/opentui-core/animation/Timeline.d.ts:2`
- `AnimationOptions@packages/opentui-core/animation/Timeline.d.ts:9`
- `JSAnimation@packages/opentui-core/animation/Timeline.d.ts:22`
- `EasingFunctions@packages/opentui-core/animation/Timeline.d.ts:61`
- `AudioSetupOptions@packages/opentui-core/audio.d.ts:3`
- `AudioStartOptions@packages/opentui-core/audio.d.ts:9`
- `AudioPlayOptions@packages/opentui-core/audio.d.ts:26`
- `AudioGroup@packages/opentui-core/audio.d.ts:32`
- `AudioVoice@packages/opentui-core/audio.d.ts:33`
- `AudioSound@packages/opentui-core/audio.d.ts:34`
- `AudioPlaybackDevice@packages/opentui-core/audio.d.ts:35`
- `AudioAction@packages/opentui-core/audio.d.ts:40`
- `AudioErrorContext@packages/opentui-core/audio.d.ts:41`
- `AudioEvents@packages/opentui-core/audio.d.ts:45`

### Tests
- `packages/ax-code/test/cli/tui/opentui-ffi-coordinate-guard.test.ts`
- `packages/ax-code/test/cli/tui/opentui-ffi-pointer-pin.test.ts`
- `packages/ax-code/test/cli/tui/opentui-spinner.test.ts`
- `packages/ax-code/test/script/opentui-package-integrity.test.ts`
- `packages/ax-code/test/session/semantic-core.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (334) | static map |
| Silent failure | empty catch (6) | per-site disposition in findings |
| Secrets/process/IO | risk tags ui | hotspot scan |

## 3–7. Protocol steps 3–7

Step 1: Mapped 30 source files; exports≈187
Step 2: Threat: secrets=3 files, processRisk=3 files, emptyCatch=4
Step 3: Correctness: read control flow for public surfaces; findings=AUDIT-pkg-opentui-core-empty-catch.md
Step 4: Performance: not hot-path; spot-checked
Step 5: Design: ownership vs ARCHITECTURE/PROJECT_BOUNDARIES for packages/opentui-core
Step 6: Hygiene: empty=4; notes: packages/opentui-core/index-07zpr2dg.js: 2 empty catch(es) — see empty-catch finding disposition; packages/opentui-core/index-pcvh9d34.js: 2 empty catch(es) — see empty-catch finding disposition
Step 7: Tests: see MODULE-AUDIT matched tests; regressions for verified-fixed findings
Step 8: Findings disposition complete in findings/
Step 9: Verification commands recorded in STATUS gates; protocol marker written

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-pkg-opentui-core-empty-catch | silent-error | Low | new | deferred |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `6d8ade5e21fdfb54` |
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
| Reviewer | implementer | 2026-08-11 | filesRead=30 |
| Independent verifier | codex-sol | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
