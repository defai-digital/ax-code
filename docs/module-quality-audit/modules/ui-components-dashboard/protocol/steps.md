# Protocol Steps — `ui-components-dashboard`

Reviewer: `ax-code-glm` (model `zai-coding-plan/glm-5.2[1m]`)
Scope root: `desktop/packages/ui/src/components/dashboard`
Baseline commit: `cab6c0089e3b7b3410f050bc9d824c06a3c3a814`

This is the primary-reviewer pass over unit `ui-components-dashboard`. Every
claim below is anchored to a concrete file and line range I opened during the
review. No template boilerplate; observations are specific to this code.

## Step 1 — Scope and source map

The unit is four files under `desktop/packages/ui/src/components/dashboard`:

- `DashboardPanel.tsx:1-127` — iframe host that resolves a desktop server origin
  and renders the DRE graph dashboard for either a matched session or the whole
  project. Exports `DashboardPanel` (`DashboardPanel.tsx:52`) plus the default
  re-export at `DashboardPanel.tsx:127`.
- `SessionPulse.tsx:1-291` — presentational "session pulse" surface (BLUF status
  card, change rows, validation list, notes). Exports `SessionPulse`
  (`SessionPulse.tsx:93`) and the internal `MetaChip`, `Section`, `ChangeRow`
  helpers (`SessionPulse.tsx:47`, `:55`, `:67`).
- `sessionPulseModel.ts:1-204` — pure view-model builder. Exports the
  `SessionPulseReadiness`/`SessionPulseChange`/`SessionPulseValidation`/
  `SessionPulseModel` types (`sessionPulseModel.ts:7`, `:9`, `:18`, `:25`),
  `buildSessionPulseModel` (`sessionPulseModel.ts:107`), and the
  `formatDurationMs` / `formatTokenCount` helpers (`sessionPulseModel.ts:186`,
  `:198`).
- `sessionPulseModel.test.ts:1-122` — Vitest suite for the model layer only.

The audit map lists `packages/ax-code/test/cli/tui/workflow-dashboard.test.ts`
as the related integration test; I did not open it because it lives outside this
unit's resolved root and covers the TUI, not these desktop components.

## Step 2 — Threat and failure surface

The two trust boundaries in this unit are (a) the cross-frame content loaded by
`DashboardPanel` and (b) the untrusted `/session/:id/dre` + `/session/:id/risk`
API payloads consumed by `buildSessionPulseModel`.

For (a), `DashboardPanel.tsx:115-121` mounts the dashboard iframe with
`sandbox="allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox
allow-same-origin allow-scripts"`. The `allow-same-origin` + `allow-scripts`
combination is the well-known combination that lets framed content remove its
own `sandbox` attribute. Here the loaded URL is the same-origin desktop server
(`DashboardPanel.tsx:13-21` derives `__AX_CODE_DESKTOP_DESKTOP_SERVER__?.origin`
or `window.location.origin`), so the framed page is first-party and the
combination is intentional rather than a third-party escape risk. The
"Open in new window" button (`DashboardPanel.tsx:102-111`) correctly passes
`noopener,noreferrer`. No secrets, no filesystem, no child-process IO is
touched anywhere in the unit.

For (b), the model layer treats every payload field as `unknown` and narrows
through `asRecord`/`asString`/`asNumber`/`asStringArray`
(`sessionPulseModel.ts:61-76`). Readiness and validation state are gated by
strict allowlists (`normalizeReadiness` at `:78-83`,
`normalizeValidationState` at `:85-88`), so a malformed payload degrades to
`"unknown"` rather than crashing the render. Empty catches: none exist in this
unit (confirmed by reading all four files end to end).

## Step 3 — Correctness of control flow

`buildSessionPulseModel` is the only non-trivial control-flow surface. Tracing
its data flow at `sessionPulseModel.ts:107-184`:

- `signals` falls back from `assessment.signals` to the whole `dreDetail`
  record (`:112`), then `readiness` prefers `assessment.readiness` over
  `dreDetail.readiness` (`:114`). Order is consistent with the docstring at
  `:103-106`.
- `changes` is capped at 12 entries (`:120`) and each row defaults `risk` to
  `"unknown"` and `kind` to `"change"` with underscores rewritten to spaces
  (`:128-129`). Safe defaults, no crash on partial rows.
- `filesChanged` falls back from `semantic.files` to `signals.filesChanged` to
  `changes.length` (`:136-137`). `additions`/`deletions` fall back to summing
  the (capped) change rows (`:138-139`) — this means the displayed total can
  exceed the sum of the visible rows when more than 12 files changed, because
  the authoritative `semantic.additions` is preferred when present. That is the
  intended behavior (total is authoritative, list is a preview), but it is a
  real UX subtlety worth noting rather than a bug.
- `reason` is built with `??` chaining through `unknowns[0]`, `drivers[0]`,
  semantic headline, and finally a readiness-conditional assessment summary
  (`:154-158`). The `SessionPulse` render then suppresses `reason` when it
  equals `decision` to avoid duplication (`SessionPulse.tsx:172`).

The format helpers are subtle and the tests target the subtlety on purpose:
`formatDurationMs` rounds to whole seconds _before_ splitting minutes/seconds
(`sessionPulseModel.ts:191`) specifically to prevent a `"1m 60s"` regression,
and the test at `sessionPulseModel.test.ts:107-110` pins `119500`, `119999`,
and `120000` all to `"2m 0s"`. `formatTokenCount` switches branch order at
`sessionPulseModel.ts:200-203`: `<1000` raw, `<10_000` one-decimal k,
`>=999_500` one-decimal m, else rounded k — the test at
`sessionPulseModel.test.ts:113-121` pins `999499`→`"999k"` and
`999500`→`"1.0m"`.

One real edge worth recording: at `formatTokenCount` the boundary
`n === 10_000` falls through `< 10_000` to the rounded-k branch and yields
`"10k"` rather than `"10.0k"`. That is consistent (no `.0` suffix once the k
value is whole) but is not covered by an explicit test case.

## Step 4 — Performance characteristics

All hot paths are cheap. `DashboardPanel` memoizes the desktop origin once
(`DashboardPanel.tsx:56`, empty deps), and derives `currentSession`,
`dashboardSession`, and `dashboardUrl` through dependency-tracked `useMemo`
calls (`:58-73`). The iframe remount on refresh is driven by a `reloadKey`
state bump (`:55`, applied at `:116`), which is the correct cheap way to force
a same-URL reload without holding extra state.

`SessionPulse` calls `formatDurationMs` / `formatTokenCount` on every render
(`SessionPulse.tsx:105-107`) but both are O(1) arithmetic. `buildSessionPulseModel`
does a single linear pass over `semantic.changes` capped at 12 rows
(`sessionPulseModel.ts:119-134`) and bounded `.slice()` calls on
unknowns/mitigations/drivers/commands (`:145`, `:149-151`). No hidden N+1, no
unbounded growth, no expensive renders inside lists. `ChangeRow` is a plain
function component (not memoized) but its render cost is trivial and the list
is small.

## Step 5 — Design and ownership

The layering inside this unit is clean and intentional: `sessionPulseModel.ts`
is a pure, framework-agnostic transformer (no React import — see `:1-6`
docstring and the lack of any `react` import through `:204`), while
`SessionPulse.tsx` and `DashboardPanel.tsx` own presentation only and delegate
all shaping to the model. This is exactly the right seam: the Vitest suite can
cover the model without a DOM, and the components stay thin.

`DashboardPanel.tsx` extracts `getDesktopServerOrigin`, `buildDashboardUrl`,
`getSessionDirectory`, and `isSameDirectory` as module-private pure functions
(`:13-50`), which keeps the component body readable and makes the URL-building
trivially auditable. `SessionPulse.tsx` similarly extracts `MetaChip`, `Section`,
and `ChangeRow` as small presentational helpers (`:47-91`).

One minor design redundancy: in `SessionPulse.tsx:27-37` the `needs_validation`
and `needs_review` entries of `readinessToneClass` resolve to identical CSS.
This is intentional (the two states share a warning tier while keeping
distinct headline labels in `READINESS_HEADLINES` at `sessionPulseModel.ts:45-51`),
so I am not flagging it as a finding — collapsing them would lose the
self-documenting per-state mapping.

## Step 6 — Hygiene and dead code

Reading every export and every helper, I found no dead code. `MetaChip`,
`Section`, `ChangeRow`, `riskDotClass`, `readinessToneClass` are all referenced
inside `SessionPulse.tsx`. All seven exports of `sessionPulseModel.ts` are
consumed (the three format/type helpers by `SessionPulse.tsx:7-13`, the model
by both the component and the test). `DashboardPanel`'s private helpers are all
called from the component body. There are no `TODO`/`FIXME` markers, no
commented-out blocks, no unreachable branches, and zero empty `catch` blocks
across the four files — consistent with the audit map's "0 empty catches /
0 TODOs" row.

Formatting follows the repo prettier config (`semi: false`, 120 width) and the
`desktop` functional-React convention from `AGENTS.md` (no `any` in source;
the single `unknown`-cast in `DashboardPanel.tsx:41-44` is a narrowing guard,
not an `any`).

## Step 7 — Test coverage

The model suite (`sessionPulseModel.test.ts`) is well-targeted at the
non-obvious logic: the empty-input fallback (`:5-11`), a full payload covering
readiness/validation/changes and explicitly asserting the absence of `score`
and `gauge` fields (`:13-78`, assertions at `:76-77`), the passed-validation
summary branch (`:80-96`), and the format-helper boundary table including the
`"1m 60s"` regression (`:99-121`).

Gaps I observed against the source:

- `formatTokenCount` has no case pinning `n === 10_000` (the boundary where the
  one-decimal-k branch ends and rounded-k begins, `sessionPulseModel.ts:201`).
- `buildSessionPulseModel` has no case exercising the `failed` validation
  state — only `passed` and `not_run`/`unknown` are covered, so the
  `validationSummary` failed branch at `:94-95` is unreached by tests.
- No case exercises `readiness === "blocked"` or `"needs_review"` end to end;
  the headline/hint tables at `:45-59` are only partially exercised.
- The `additions`/`deletions` fallback that sums change rows
  (`sessionPulseModel.ts:138-139`) is not tested independently of the
  authoritative `semantic.additions` path.
- The two presentational components (`DashboardPanel.tsx`, `SessionPulse.tsx`)
  have no unit tests in this package; their rendering branches (loading vs
  error vs empty vs populated, and the `reason !== decision` dedupe at
  `SessionPulse.tsx:172`) are exercised only via the cross-package TUI test
  referenced in the audit map, which I did not open.

These are coverage notes, not defects — the logic that _is_ tested is tested
precisely at its tricky boundaries.

## Step 8 — Findings register

After reading all four files in full and tracing the model control flow, I have
no accepted findings to register against this unit. The observations above
(sandbox attribute composition, total-vs-visible addition subtlety,
`needs_validation`/`needs_review` shared styling, the test-coverage gaps) are
either intentional design decisions or non-blocking coverage notes, so none
warrant a `findings/*.md` entry. The `findings/` directory for this unit is
empty, which is consistent with this conclusion.

## Step 9 — Verification and exit

Verification for a documentation-only review pass is the correct on-disk shape
of the protocol artifacts plus an internal consistency check of the evidence
above. Concretely:

- Every file:line reference in steps 1–8 resolves to a real location I opened
  during this pass (the four source files plus `MODULE-AUDIT.md`).
- No Critical-severity items exist for `ui-components-dashboard` (the
  `findings/` directory is empty), so no `protocol/reverify.md` is required by
  the protocol gate.
- The recommended live checks for a follow-up implementer touching this unit
  are `pnpm --dir desktop exec vitest run src/components/dashboard` for the
  model suite and `pnpm run desktop:typecheck` for the component types; I did
  not execute them here because this pass made no code changes.

Exit status: 9-step protocol complete as primary reviewer; the unit remains
`REVIEWING` pending the independent verifier (`codex-sol`) sign-off recorded in
`MODULE-AUDIT.md`.
