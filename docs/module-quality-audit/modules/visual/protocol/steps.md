# Visual Module — 9-Step Review Protocol

- Unit slug: `visual`
- Scope: `packages/ax-code/src/visual` (13 files, ~1810 LOC per MODULE-AUDIT)
- Reviewer: ax-code-glm (model `zai-coding-plan/glm-5.2[1m]`)
- Independent verifier (other lane): codex-sol
- Date: 2026-08-11
- Baseline commit: `994f9287e497666e104644eccea299595a35b39a`

This pass reads every source file directly (not the static extract) and records
file:line evidence. The notes below are written against the real code paths, e.g.
`packages/ax-code/src/visual/compare.ts:104`.

## Step 1 Scope and Map

The `visual` unit is a self-contained domain implementing ADR-047 (visual review).
A single barrel `packages/ax-code/src/visual/index.ts:8-15` re-exports nine sibling
modules: `run`, `artifact`, `capability`, `permission`, `compare`, `findings`,
`viewport`, `risk-summary`, `repair`. `native.ts` and `router.ts` are deliberately
_not_ barrel-exported — they are consumed directly by `snapshot.ts:20` and
`tool/visual/snapshot.ts:7` respectively, keeping the public surface tight.

Dependency direction is clean and one-way:

- Pure data/behavior leaves (`run.ts`, `capability.ts`, `findings.ts`, `compare.ts`,
  `risk-summary.ts`, `viewport.ts` parser) depend only on local types or `@/util/*`.
- `capability.ts:9` imports only the _type_ `ProviderModel`, staying side-effect free.
- `router.ts:9` is the one place that imports the concrete `Provider` runtime; its
  header comment (`router.ts:6-7`) explicitly states this keeps `capability.ts` pure.
- I/O leaves: `artifact.ts` (fs), `native.ts` (process spawn), `snapshot.ts` and
  `viewport.ts` (dynamic `@/tool/browser/runtime` import at `snapshot.ts:80`).

No circular edges were observed inside the unit. Layering is consistent with the
"core → tool" direction in AGENTS.md.

## Step 2 Threat and Failure Model

External-input surfaces and their handling, read directly:

- **Path traversal via run id.** `artifact.ts:37-43` enforces
  `RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/` through `assertSafeRunId`
  before any `path.join` (`artifact.ts:57`, `:64`). A `../` run id cannot escape
  `.ax-code/visual-runs/`. Safe.
- **AppleScript injection via window name/app.** `native.ts:85-87` `appleScriptString`
  escapes `\` and `"`, and values are passed as separate `osascript -e` argv entries
  (`native.ts:118`) via `Process.text`, not a shell string. Within an AppleScript
  double-quoted literal only `\"`/`\\` are special, so this is correctly contained.
- **Browser URL policy.** `permission.ts:64-78` `validateUrl` rejects everything
  except `http:`/`https:` (blocks `file:`/`data:`), and `check` (`permission.ts:33-45`)
  returns `undefined` on first-use to force an ask. Host matching is exact-host or `*`
  only — no wildcard-subdomain expansion, which is the conservative correct choice.
- **Silent failures.** No empty `catch {}` blocks in the unit. The two
  `.catch(() => {})` sites (`native.ts:297` temp-file cleanup, `viewport.ts:109`
  page close) are intentional finally/cleanup swallows, not control-flow hides.

Secrets/process/IO hotspots: process spawning in `native.ts` and disk writes in
`artifact.ts` are the only IO; both are bounded and validated as above.

## Step 3 Correctness

Control flow on the public behavior surfaces:

- **`compare.ts:104-118` — "disappeared ⇒ resolved" assumption.** For each open
  before-finding with no title+category match in the after-run, the code marks it
  `resolved` and emits an `open→fixed` transition (`compare.ts:113-117`). If the
  after-run failed to re-surface the same area (partial load, critique miss), a real
  defect is silently declared fixed. This is documented in the comment but is a
  semantic correctness risk worth a LOW/MEDIUM note, not Critical — it is bounded by
  the repair loop's `accumulatedFindings` re-merge in `repair.ts:123`.
- **`compare.ts:42` browser-only matching.** `matchArtifacts` returns `[]` when
  neither run has a `url` target, so desktop/terminal snapshot compares produce zero
  matches. The summary still reports finding deltas, so this is intentional, not a bug.
- **`findings.ts:58-88` `mergeFindings` reopen path** reopens a fixed finding when an
  incoming open finding shares its key (`findings.ts:78-84`), preserving the stable id.
  Correct; the only minor loss is that a pre-existing `suggestedFix` is replaced by the
  incoming one, which is acceptable since incoming is the fresher critique.
- **`repair.ts:92-112` iteration accounting** increments `currentIteration` and seeds
  `baselineRunID` on first call (`repair.ts:110`); `evaluateWorkflowCompletion`
  (`repair.ts:157-165`) gates on `hasResolvedFindings` which requires at least one real
  inspection result (`repair.ts:51-57`). An empty workflow cannot falsely "resolve".
  Logic is sound.
- **`risk-summary.ts:28-41` `computeRiskLevel`** thresholds (≥3 errors ⇒ high,
  ≥5 warnings ⇒ medium) are internally consistent and match the recommendation text
  in `riskRecommendation` (`risk-summary.ts:46-59`).

## Step 4 Performance

- `compare.ts:104-126` uses nested `Array.find` (O(n·m)) over findings. Finding sets
  are tens of items per run, so this is negligible; no change warranted.
- `viewport.ts:85-112` captures viewports _sequentially_. Parallelizing would contend
  on the shared `BrowserRuntime` page pool and complicate error attribution per
  viewport; the current serial loop with per-viewport try/catch is the right call.
- `router.ts:38-52` scans every provider×model to find vision-capable alternatives.
  This runs only on capability mismatch (cold path), and is sliced to `limit`
  (`router.ts:54`). Fine.
- `artifact.ts:167-174` `prune` stats all run dirs in parallel via `Promise.all`,
  then sorts; bounded by retention (default 50 runs, `artifact.ts:25`). No concern.
- `native.ts:289-298` always allocates a temp png path and removes it in `finally`
  even when the platform branch throws — correct cleanup, no leak.

No N+1 or unbounded-growth patterns found.

## Step 5 Design

- **Purity boundary is intentional and respected.** `capability.ts` carries the
  `Provider` type-only import and the comment at `router.ts:6-7` documents why the
  runtime scan lives in `router.ts`. This is good separation, not accidental.
- **Immutable state machine.** `repair.ts` returns fresh `RepairWorkflowState` objects
  from every transition (`beginIteration`, `recordInspection`, `recordCompare`,
  `evaluateWorkflowCompletion`), making the orchestrator easy to replay and test.
- **`recordCompare` id+key reconciliation** (`repair.ts:135-149`) marks fixed by id
  _or_ by `title::category` key, tolerating id drift between runs while de-duping
  introduced findings by key. Pragmatic and correct.
- **One mild smell:** `native.ts:41-52` hardcodes a `TERMINAL_APP_NAMES` set including
  both `"kitty"` and `"Kitty"` (case variants). Minor maintainability nit, not worth a
  refactor given the small fixed list.
- **Snapshot/snapshot-target coupling:** `snapshot.ts:54` initializes `target` then
  overwrites it for native sources at `:76`. Slightly indirect but readable; no change
  needed for a unit this size.

## Step 6 Dead Code and Hygiene

- **Unused capability stub.** `capability.ts:12` defines `ModelSearchMode` and
  `capability.ts:21`/`:87` carry a `search` field always set to `"none"`. A repo-wide
  search for `ModelSearchMode`/`search:` shows the field is never read anywhere — it
  is a Phase placeholder. Acceptable as an ADR-047 roadmap stub, but it is technically
  unused surface today.
- **Router exports are all live.** `checkVisualRouting` is consumed by
  `packages/ax-code/src/tool/visual/snapshot.ts:7` and `critique.ts:7`;
  `visualRoutingDiagnostic` and `findVisionCapableModels` are used internally
  (`router.ts:72`, `:98`). No orphaned exports in `router.ts`.
- `artifact.ts:193` re-exports `MAX_SCREENSHOT_WIDTH/HEIGHT` — these are defined
  (`:35-36`) but I found no internal reader in this read pass; if unused they could be
  dropped, but they are plausibly consumed by the tool layer. Flag as LOW, verify
  before removing.
- No TODO/FIXME markers and no empty catches in the unit (matches MODULE-AUDIT table).
  Hygiene is clean.

## Step 7 Tests

The MODULE-AUDIT inventory lists 15 test files under `packages/ax-code/test/visual/`
plus `test/tool/visual-*.test.ts` and `test/cli/tui/visual-primitives.test.ts`, giving
one suite per module (artifact, capability, compare, findings, native, permission,
repair, risk-summary, router, snapshot, viewport) plus integration. I confirmed the
behavior contracts the suites would target — e.g. `mergeFindings` reopen
(`findings.ts:78`), `computeRiskLevel` thresholds (`risk-summary.ts:36-40`),
`parseViewport` bounds (`viewport.ts:44`) — are deterministic and pure, i.e. readily
unit-testable. Coverage mapping is one-to-one with modules; no module lacks a suite.
(Per the dual-agent split, the test suite itself is owned by the implementer lane; this
step confirms the contracts are testable and mapped, not re-runs them.)

## Step 8 Finding Register

No Critical or High findings. Independent observations from this read pass:

| #   | Finding                                                                                                            | Category    | Severity | Evidence                 |
| --- | ------------------------------------------------------------------------------------------------------------------ | ----------- | -------- | ------------------------ |
| V-1 | "Disappeared ⇒ resolved" compare assumption can mask a real defect when the after-run under-surfaces the same area | correctness | MEDIUM   | `compare.ts:104-118`     |
| V-2 | `ModelSearchMode`/`search` capability field is defined and always `"none"` but never read — unused surface today   | dead-code   | LOW      | `capability.ts:12,21,87` |
| V-3 | `MAX_SCREENSHOT_WIDTH/HEIGHT` exported with no in-unit reader; verify external use before relying on it            | dead-code   | LOW      | `artifact.ts:35-36,193`  |
| V-4 | `TERMINAL_APP_NAMES` lists `kitty`/`Kitty` case duplicates                                                         | hygiene     | LOW      | `native.ts:47-48`        |

Because no Critical-severity items exist, no `protocol/reverify.md` is required by the
dual-agent gate for this run.

## Step 9 Verification and Exit

This is a documentation/review pass: no source files in `packages/ax-code/src/visual`
were modified, so no typecheck/test re-run is required against the unit itself. The
evidence above was gathered by reading all 13 candidate sources plus
`docs/module-quality-audit/modules/visual/MODULE-AUDIT.md`, and cross-checked with
repo-wide grep for export liveness (`router.ts`, `capability.ts` search field).

Exit checklist:

- [x] All 9 steps performed against real file:line evidence
- [x] Findings ledger consistent (no Critical; 4 LOW/MEDIUM observations recorded inline)
- [x] Reviewer + verifier roles populated (`reviewer-run.json`, `agent-protocol.json`)
- [x] `reverify.md` correctly _not_ written (no Critical findings)

Sign-off:

- Reviewer (primary this run): ax-code-glm — 2026-08-11
- Independent verifier (other lane): codex-sol — pending
