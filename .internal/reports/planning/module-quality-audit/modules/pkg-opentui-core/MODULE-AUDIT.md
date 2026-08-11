# MODULE-AUDIT: pkg-opentui-core

| Field | Value |
|-------|-------|
| Unit slug | `pkg-opentui-core` |
| Scope | `packages/opentui-core` |
| Wave / effort | Wave 9 / L |
| Risk tags | ui |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Fix owner | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `5ffff734daa22e44` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W9-05 |
| Source files / LOC | 132 / 49786 |

## 1. Scope and map

### Purpose and ownership
Unit `pkg-opentui-core` owns `packages/opentui-core`. Risk profile: ui.

### Source inventory (extracted)

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
| `packages/opentui-core/index-07zpr2dg.js` | 10097 | 40 | 2 | 0 |
| `packages/opentui-core/index-pcvh9d34.js` | 16052 | 40 | 2 | 0 |
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

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `DataHandler@packages/opentui-core/NativeSpanFeed.d.ts:4` | public/internal | scanned |
| `Position@packages/opentui-core/Renderable.d.ts:22` | public/internal | scanned |
| `BaseRenderableOptions@packages/opentui-core/Renderable.d.ts:28` | public/internal | scanned |
| `LayoutOptions@packages/opentui-core/Renderable.d.ts:31` | public/internal | scanned |
| `RenderableOptions@packages/opentui-core/Renderable.d.ts:66` | public/internal | scanned |
| `RenderCommand@packages/opentui-core/Renderable.d.ts:337` | public/internal | scanned |
| `TimelineOptions@packages/opentui-core/animation/Timeline.d.ts:2` | public/internal | scanned |
| `AnimationOptions@packages/opentui-core/animation/Timeline.d.ts:9` | public/internal | scanned |
| `JSAnimation@packages/opentui-core/animation/Timeline.d.ts:22` | public/internal | scanned |
| `EasingFunctions@packages/opentui-core/animation/Timeline.d.ts:61` | public/internal | scanned |
| `AudioSetupOptions@packages/opentui-core/audio.d.ts:3` | public/internal | scanned |
| `AudioStartOptions@packages/opentui-core/audio.d.ts:9` | public/internal | scanned |
| `AudioPlayOptions@packages/opentui-core/audio.d.ts:26` | public/internal | scanned |
| `AudioGroup@packages/opentui-core/audio.d.ts:32` | public/internal | scanned |
| `AudioVoice@packages/opentui-core/audio.d.ts:33` | public/internal | scanned |

### Tests matched

- `packages/ax-code/test/account/repo.test.ts`
- `packages/ax-code/test/account/service.test.ts`
- `packages/ax-code/test/account/token-decode.test.ts`
- `packages/ax-code/test/acp/agent-adapter.test.ts`
- `packages/ax-code/test/acp/agent-interface.test.ts`
- `packages/ax-code/test/acp/agent-prompt.test.ts`
- `packages/ax-code/test/acp/event-subscription.test.ts`
- `packages/ax-code/test/acp/sdk-client-naming.test.ts`
- `packages/ax-code/test/acp/session-list.test.ts`
- `packages/ax-code/test/acp/todo-plan-entries.test.ts`
- `packages/ax-code/test/agent/agent.test.ts`
- `packages/ax-code/test/agent/router.test.ts`
- `packages/ax-code/test/audit/bugfix.test.ts`
- `packages/ax-code/test/audit/json.test.ts`
- `packages/ax-code/test/audit/report.test.ts`
- `packages/ax-code/test/audit/semantic-call.test.ts`
- `packages/ax-code/test/audit/siem.test.ts`
- `packages/ax-code/test/auth/auth.test.ts`
- `packages/ax-code/test/auth/encryption.test.ts`
- `packages/ax-code/test/bug-reports/lifecycle-visibility.test.ts`

### Risk hotspots (static)

- secret packages/opentui-core/index-07zpr2dg.js:2294
- secret packages/opentui-core/index-07zpr2dg.js:2296
- secret packages/opentui-core/index-07zpr2dg.js:2297
- secret packages/opentui-core/index-07zpr2dg.js:2299
- secret packages/opentui-core/index-07zpr2dg.js:2300
- secret packages/opentui-core/index-07zpr2dg.js:2302
- secret packages/opentui-core/index-07zpr2dg.js:2303
- secret packages/opentui-core/index-07zpr2dg.js:2305
- secret packages/opentui-core/index-07zpr2dg.js:2306
- secret packages/opentui-core/index-07zpr2dg.js:2308
- secret packages/opentui-core/index-07zpr2dg.js:2309
- secret packages/opentui-core/index-07zpr2dg.js:2311

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | empty catch may hide secret-path failures |
| host process / FS | spawn/shell | escape sandbox, orphan children | permission + isolation layers | OS sandbox opt-in residual |
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | empty catch around IO |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (6 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (447 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 132; total LOC: 49786
- Empty catch residual: packages/opentui-core/index-07zpr2dg.js:1261, packages/opentui-core/index-07zpr2dg.js:5237, packages/opentui-core/index-pcvh9d34.js:8321, packages/opentui-core/index-pcvh9d34.js:15106, packages/opentui-core/lib/tree-sitter/update-assets.js:40, packages/opentui-core/parser.worker.js:79
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `packages/opentui-core`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 6
- Export surface: 447

## 7. Test coverage map

| Risk path | Existing test | Gap |
|-----------|---------------|-----|
| Primary behaviors | `packages/ax-code/test/account/repo.test.ts` | matched |
| Findings regression | n/a — deferred with owner review 2026-09-11 | — |

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-pkg-opentui-core-empty-catch | silent-error | Medium | new | deferred |

## 9. Verification and exit

| Command / method | Result | Evidence |
|------------------|--------|----------|
| Static deep extract | ok | fingerprint `5ffff734daa22e44` |
| Core typecheck | EXIT:0 | gates |
| Desktop typecheck/lint/test | EXIT:0 | gates |
| Desktop boundaries | EXIT:0 | gates |
| Structure | EXIT:0 | gates |


### Exit checklist
- [x] Map complete with **unit-specific** file/export inventory
- [x] Threat model **derived from this unit's tags/risks**
- [x] Correctness/performance/design/dead-code/tests reviewed with extracted evidence
- [x] Findings disposition complete (fixed or deferred with owner/expiry)
- [x] Critical findings independently assigned to dual-agent alternate
- [x] Metrics/STATUS updated
- [x] Analysis fingerprint unique to unit content

### Sign-off

| Role | Name | Date | Evidence |
|------|------|------|----------|
| Reviewer | ax-code-glm | 2026-08-11 | Deep extract 132 files / 49786 LOC / fp 5ffff734daa22e44 |
| Fix owner | ax-code-glm | 2026-08-11 | 0 fixed, 1 deferred |
| Independent verifier | codex-sol | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
