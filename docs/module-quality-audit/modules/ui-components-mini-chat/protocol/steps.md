# Protocol Steps — ui-components-mini-chat

Reviewer: `ax-code-glm` (model `zai-coding-plan/glm-5.2[1m]`)
Unit: `ui-components-mini-chat` → `desktop/packages/ui/src/components/mini-chat`
Baseline commit: `cab6c0089e3b7b3410f050bc9d824c06a3c3a814`

This is a real, independent 9-step pass over the six unit files plus two of their
non-unit dependencies (`desktop/packages/ui/src/lib/projectResolution.ts` and
`desktop/packages/ui/src/lib/utils.ts`) that I opened to confirm the helper
contracts cited below.

## Step 1 Scope and map

The unit is small and bipartite. `MiniChatLayout.tsx` (350 lines) is the heavyweight
surface: it defines both the exported `MiniChatLayout` (lines 328–350, ~22 lines of
JSX shell) and an inline, non-exported `MiniChatHeader` (lines 32–326) that owns all
the meaningful logic — IPC pinning/minimize/main-handoff, directory normalization,
git branch resolution, context-usage stabilization, and project matching.

The other five files are deliberately tiny and pure:

- `miniChatPath.ts` (46 lines) — `normalizeMiniChatPath`, `compactMiniChatPath`,
  `findMiniChatProjectForDirectory`, plus the `MiniChatProjectPath` shape. All three
  behaviors are covered by `miniChatPath.test.ts` (50 lines, 5 cases across Windows
  case-insensitivity, POSIX case-sensitivity, home replacement, and 3-segment
  compaction).
- `miniChatMainHandoff.ts` (40 lines) — `buildMiniChatMainHandoffPayload` and the
  `MiniChatMainHandoffPayload` discriminated union. Covered by
  `miniChatMainHandoff.test.ts` (46 lines, 3 cases: session preference, fallback
  chain, draft mode with whitespace trimming).
- `types.ts` (1 line) — single `MiniChatMode = "session" | "draft"` alias consumed by
  `MiniChatLayout.tsx:24,27,32`.

I confirmed the export inventory in `MODULE-AUDIT.md` §1 (8 exports) matches what
the source actually re-exports.

## Step 2 Threat and failure model

This is desktop UI glue, so the failure surface is IPC + window globals, not
network or persistence:

- `MiniChatLayout.tsx:9` imports `invokeDesktop, isElectronShell`. Call sites:
  `:79` `desktop_get_window_pinned` (read on mount), `:212`
  `desktop_set_window_pinned` (write with rollback), `:218`
  `desktop_minimize_current_window` (fire-and-forget), `:229–231`
  `desktop_focus_main_window` chained into `desktop_close_current_window`.
- Window globals read at `:62` (`__AX_CODE_DESKTOP_MACOS_MAJOR__`) and `:93`
  (`__AX_CODE_DESKTOP_HOME__`). Both are typed loosely and defaulted safely
  (`?? 0`, `""`) so SSR / non-Electron shells do not crash. `isElectronShell()`
  guards the minimize button render at `:289`.

I did not find any secret handling, filesystem writes, network calls, or eval-style
constructs in the unit. The assets at risk are purely UX state (pinned flag,
focused window) and the handoff payload sent to the main window.

## Step 3 Correctness — control flow and edge cases

`buildMiniChatMainHandoffPayload` (`miniChatMainHandoff.ts:20–40`) is the unit's
load-bearing contract for window handoff. Its `firstNonEmpty` helper (`:12–18`)
trims every input and returns `""` only when all are blank. The session branch at
`:28–33` correctly falls through `openDirectory → sessionDirectory → currentDirectory`,
matching the test at `miniChatMainHandoff.test.ts:5–17` (worktree wins over repo
root) and `:19–31` (session beats fallback). The draft branch at `:35–39` omits
`sessionDirectory` intentionally — confirmed by the `/repo` / `project-1`
trimming test at `:33–45`. Behavior matches the discriminated union; no code path
can return `directory: ""` because `firstNonEmpty` defaults to `""` and the caller
in `MiniChatLayout.tsx:222–228` passes `openDirectory`, which itself is computed at
`:92` as `worktreeDirectory || sessionDirectory || draftDirectory || currentDirectoryNormalized`
— always non-empty when a session or directory exists.

In `compactMiniChatPath` (`miniChatPath.ts:10–22`), the home-substitution is
delegated to `formatPathForDisplay` (`utils.ts:97–120`), which I read to verify the
`~` / `~/...` return values that `miniChatPath.ts:15` checks for. The
three-segment compaction at `:19–21` only triggers when `formatPathForDisplay`
returns a non-home absolute path; the POSIX test at `miniChatPath.test.ts:24–26`
(`/var/tmp/projects/acme/web/src → .../acme/web/src`) confirms the slice. The
asymmetry between Windows (case-insensitive, returns `~/...`) and POSIX
(case-sensitive, returns `.../...`) at `miniChatPath.test.ts:16–26` is intentional
and rooted in `projectPathMatchesRoot`'s `toComparableProjectPath` lower-casing
only `//` and `[A-Z]:/` roots (`projectResolution.ts:16–17`).

`handleTogglePinned` (`MiniChatLayout.tsx:209–215`) uses correct optimistic-rollback
semantics: `setPinned(nextPinned)` synchronously, then `.catch(() => setPinned(!nextPinned))`
on failure. `handleOpenMainApp` (`:221–235`) only closes the mini window when
`result?.focused === true` — a false-y response leaves the window open, which is the
right fail-safe for a handoff that did not land.

## Step 4 Performance and re-render hygiene

`MiniChatLayout.tsx` is a header that subscribes to many stores. I counted 11
distinct `useSessionUIStore(...)` / `useProjectsStore(...)` / `useConfigStore(...)`
/ `useGitStore(...)` / `useDirectoryStore(...)` / `useSessionWorktreeStore(...)`
subscriptions in `MiniChatHeader` alone (`:34–54`, `:95–104`). Each is a separate
zustand subscription returning a primitive or short string, so the per-update cost
is fine.

Two spots deserve a flag:

- `catalogWorktreeBranch` at `:95–104` runs a full `for...of` over every value in
  `availableWorktreesByProject` plus an inner `worktrees.find` and a
  `normalizeMiniChatPath` call **inside the selector**. Selectors should be cheap
  because zustand re-executes them on every store change. This one is O(projects ×
  worktrees) per store tick. It is not on a hot path, but it is the most expensive
  selector in the file and an obvious candidate for `useMemo` keyed on
  `availableWorktreesByProject` + `candidateDirectory`.
- `stableContextUsage` (`:172`, effect `:176–202`) is a hand-rolled memoizer that
  suppresses flapping when token totals transiently drop. The seven-field equality
  check at `:184–193` is correct but brittle — adding a new `SessionContextUsage`
  field would silently break the dedup. A comment linking the field list to
  `SessionContextUsage` would prevent drift.

`latestAssistantModel` (`:138–148`) walks the message array backwards and is
memoized on `[currentSessionMessages, providers]`, so its O(n) cost only re-runs on
real message/provider change. Acceptable.

## Step 5 Design and ownership

The unit's design split is good: pure, well-tested helpers (`miniChatPath.ts`,
`miniChatMainHandoff.ts`) sit beside a JSX component that owns only rendering and
IPC orchestration. The `MiniChatMainHandoffPayload` discriminated union is the
right shape for a typed handoff message.

The clearest ownership smell is structural: `MiniChatLayout.tsx` is misnamed by
weight. `MiniChatLayout` (the export) is 22 lines; `MiniChatHeader` (inline,
non-exported) is ~295 lines and contains every non-trivial hook, callback, and
effect. The file behaves as a header module that happens to also export a layout.
Splitting `MiniChatHeader` into `desktop/packages/ui/src/components/mini-chat/MiniChatHeader.tsx`
would make ownership readable and shrink `MiniChatLayout.tsx` to its real job. This
is a LOW-priority cleanup, not a defect.

A smaller ownership nit: `session` is structurally cast to `{ directory?: string |
null }` / `{ worktreeMetadata?: {...} }` / `{ directory?: string | null }` four
separate times (`MiniChatLayout.tsx:72–75`, `:87`, `:133`, `:225`). The real type
comes from `useSessions()`; a single local `type MiniChatSession = ...` alias (or
importing the session type from `@/sync/sync-context`) would remove the repeated
cast and the `as Parameters<typeof resolveSessionDiffStats>[0]` at `:133`.

## Step 6 Hygiene, dead code, and audit-map discrepancies

The unit itself is clean: no TODOs, no commented-out blocks, no unused imports —
`React`, `Button`, `ChatContainer`, `ChatSurfaceProvider`, `ContextUsageDisplay`,
`SessionSwitcherDropdown`, `cn`, `useI18n`, `invokeDesktop`, `isElectronShell`,
all five stores, `resolveSessionDiffStats`, `Icon`, `useRuntimeAPIs`,
`buildSessionContextUsage`, `findLatestAssistantTokenUsage`,
`buildMiniChatMainHandoffPayload`, and the three `miniChatPath` helpers are all
referenced.

I did find two discrepancies between `MODULE-AUDIT.md` and the source:

1. **Empty-catch count.** The §1 inventory table reports "Empty catches: 0" for
   `MiniChatLayout.tsx`. The file actually has at least two truly empty
   `.catch(() => {})` arrows: `MiniChatLayout.tsx:107`
   (`ensureGitStatus(...).catch(() => {})`) and `:218`
   (`invokeDesktop("desktop_minimize_current_window").catch(() => {})`). The catch
   at `:212` is **not** empty (it rolls back `pinned`), and the `desktop_focus_main_window`
   promise at `:229` has no `.catch` at all. The static map undercounts.
2. **Test mapping.** §1 says "Tests: none auto-matched", but the unit ships two
   co-located `*.test.ts` files (`miniChatPath.test.ts`, `miniChatMainHandoff.test.ts`)
   with 8 test cases covering every exported helper. The matcher paired them with
   nothing; the §3–7 placeholder deferring test review to the audit doc is therefore misleading.

Neither discrepancy is a code defect — the empty catches are intentional
fire-and-forget IPC, and the tests genuinely exist — but the audit map should be
corrected so the next reviewer does not re-litigate them.

## Step 7 Tests

Direct read of the two test files:

- `miniChatPath.test.ts` — 5 cases. `normalizeMiniChatPath` (Windows drive upper +
  trailing slash strip, blank input → `""`), `compactMiniChatPath` (Windows home
  case-insensitive, POSIX home case-sensitive → `.../Alice/...`, non-home 3-segment
  compaction), `findMiniChatProjectForDirectory` (Windows case-insensitive match,
  explicit `projectDirectory` beats `directory`, POSIX case-sensitive miss returns
  `null`). Coverage of the helper's contract is complete.
- `miniChatMainHandoff.test.ts` — 3 cases. Session payload prefers `openDirectory`,
  falls back through `sessionDirectory → currentDirectory`, and the draft branch
  trims whitespace on both `directory` and `projectId`. Coverage is complete for the
  two branches of the discriminated union.

What is **not** covered: `MiniChatLayout.tsx` / `MiniChatHeader` have no component
test. The header is mostly glue (IPC + store wiring), and the two pieces of logic
worth pinning — the `openDirectory` fallback chain at `:92` and the
`stableContextUsage` flap-suppression at `:176–202` — are exercised only through
the helpers. A focused hook-level test for `stableContextUsage` (the seven-field
equality) would be the highest-value addition, since that is the one place where a
silent regression could cause the context-usage chip to flicker or stick. LOW
priority given the component's narrow blast radius.

## Step 8 Finding register

No prior findings in `docs/module-quality-audit/modules/ui-components-mini-chat/findings/`
(directory empty as of this pass). From this review I record the following,
none Critical/High:

- **INFO — Audit-map mismatch on empty catches.** `MODULE-AUDIT.md` §1 reports 0
  empty catches for `MiniChatLayout.tsx`; `:107` and `:218` are empty
  fire-and-forget IPC catches. Update the inventory or annotate the catches with
  why they are intentionally silent.
- **INFO — Audit-map mismatch on tests.** `MODULE-AUDIT.md` §1 reports "Tests:
  none auto-matched"; two co-located `*.test.ts` files exist with 8 cases. Re-run
  the matcher or hand-list them.
- **LOW — Repeated structural casts of `session`.** `MiniChatLayout.tsx:72–75, 87,
133, 225` cast `session` four times. Introduce a local typed alias or import the
  session type from `@/sync/sync-context`.
- **LOW — Expensive zustand selector.** `MiniChatLayout.tsx:95–104`
  (`catalogWorktreeBranch`) iterates the full `availableWorktreesByProject` map on
  every store tick. Hoist into `useMemo` keyed on the map + candidate directory.
- **LOW — Inline `MiniChatHeader` dominates the layout file.** Splitting it into
  `MiniChatHeader.tsx` would make ownership readable; current state is acceptable.

## Step 9 Verification and exit

I am the primary reviewer for `ui-components-mini-chat` (lane `ax-code-glm`,
verifier lane `codex-sol`). This pass found **no Critical and no High** severity
items, so the independent-verifier `reverify.md` gate is not triggered for this
unit. The five findings above are INFO/LOW and do not block sign-off.

Confidence basis: I read all six unit files end-to-end, plus
`desktop/packages/ui/src/lib/projectResolution.ts` and the relevant slice of
`desktop/packages/ui/src/lib/utils.ts` to verify the helper contracts that
`miniChatPath.ts` delegates to. I cross-checked the `MODULE-AUDIT.md` inventory
table against the source and surfaced two documentation mismatches.

Recommended next actions, in priority order: (1) correct the audit-map empty-catch
and test counts; (2) hoist `catalogWorktreeBranch` into `useMemo`; (3) introduce a
typed `session` alias to kill the repeated casts. None are blockers.
