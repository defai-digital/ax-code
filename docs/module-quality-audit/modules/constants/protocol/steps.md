# constants — 9-step protocol review

- **Unit slug:** `constants`
- **Scope:** `packages/ax-code/src/constants` (7 files, 173 LOC per MODULE-AUDIT inventory)
- **Reviewer (primary this pass):** ax-code-glm — model `zai-coding-plan/glm-5.2[1m]`
- **Independent verifier (other lane):** codex-sol
- **Date:** 2026-08-11
- **Baseline commit:** `994f9287e497666e104644eccea299595a35b39a`

This is the dual-agent 9-step pass for the `constants` unit. All evidence
below is anchored to files actually read this session
(`packages/ax-code/src/constants/*.ts` plus call-site reads in
`packages/ax-code/src/tool/`, `src/session/`, `src/lsp/server-defs/`).

## Step 1 Scope and map

The unit is a barrel plus six leaf modules. `packages/ax-code/src/constants/index.ts:1-5`
re-exports everything from `./tool ./session ./network ./lsp ./project` — note the
barrel deliberately omits `./server` (server-only constants are surfaced instead via
`packages/ax-code/src/server/constants.ts:1`, which re-exports
`DEFAULT_SERVER_PORT, MAX_PATH_LENGTH, TOAST_DURATION_LONG_MS` from `@/constants/server`).
That split is intentional but worth recording: two different import paths
(`@/constants` vs `@/server/constants`) hand out overlapping surfaces, and a reader
who greps `index.ts` will not see `server.ts` at all.

Leaf inventory confirmed against the read: `lsp.ts` (1 export), `network.ts` (7),
`project.ts` (13), `server.ts` (3), `session.ts` (14), `tool.ts` (8). All exports are
`const` literals or `readonly` aggregates — no functions, no classes, no runtime side
effects. This is the lowest-risk shape a module can take.

## Step 2 Threat and failure model

The `constants` unit itself performs no I/O and holds no mutable state, so the failure
surface is "wrong value propagates to N callers" rather than runtime crash. The
highest-leverage assets are the centralized identity strings in
`packages/ax-code/src/constants/project.ts:8-42` (`GITHUB_ORG`, `PACKAGE_NAME`, and the
derived `GITHUB_REPO_SLUG`/URLs/tap refs): an incorrect org/repo here silently corrupts
config schema URLs (`config-impl.ts:413,1248,1335`), the self-upgrade install path
(`installation/index.ts:223`), the GitHub Action ref written into user workflow YAML
(`cli/cmd/github-agent/install.ts:217`), and the Homebrew tap resolution
(`installation/index.ts:208-273`). The derivation chain (`project.ts:12-42`) is sound —
everything composes from `GITHUB_ORG` + `PACKAGE_NAME` — so a single-source edit is safe.

The autonomous guard values in `session.ts:47-97` are a second asset class: caps that
are too loose let runaway loops burn tokens, too tight abort legitimate batches (the
`#179` regression cited in the `session.ts:40-46` comment). No credential-shaped literal
is present in any of the seven files.

## Step 3 Correctness of public surfaces

Each exported constant was traced to at least one consumer to confirm the value is
load-bearing and the type matches the call site.

- `MAX_PATH_LENGTH` (`server.ts:3`, `4096`) flows into a zod `.max()` bound at
  `session/metadata.ts:26,45` and `server/routes/file.ts:14` — correct: `string.max` takes
  character length and `4096` is the intended filesystem-name ceiling.
- `MAX_LINE_LENGTH` + `MAX_LINE_SUFFIX` (`tool.ts:3-4`) drive the truncation path in
  `tool/read.ts:263-264`, which reconstructs the suffix from the same constant via the
  template literal — the displayed char count cannot drift from the actual cut.
- `GOAL_TOTAL_STEP_HEADROOM = SUPER_LONG_TOTAL_STEP_HEADROOM` (`session.ts:25`) is a true
  alias, so the two long-run backstops cannot diverge — this is the correct pattern.
- `AUTONOMOUS_BLOCKED_PATHS` (`session.ts:59-76`) is consumed by
  `session/blast-radius.ts:52` and `control-plane/safety-policy.ts:55`. The `session.ts:51-58`
  comment documents that `Wildcard.match` collapses `*`/`**`, so each "anywhere" guard is
  listed both anchored and with a leading `**/`. Verified the pairs are complete:
  `.env`+`**/.env`, `.env.*`+`**/.env.*`, `secrets/**`+`**/secrets/**`,
  `.git/hooks/**`+`**/.git/hooks/**`. No orphan single-form entry.

Control flow is trivial (module-init evaluation only); no conditional exports, no
runtime branching. No correctness defect found in the unit itself. The one cross-module
correctness concern (the duplicate `JS_LOCKFILES`) is logged under Step 5/8 because its
root is in `lsp/server-defs`, not in this unit.

## Step 4 Performance

No code executes at runtime beyond a handful of template-literal interpolations at
module load (`project.ts:12-42`, `tool.ts:4,6`). These run once and the results are
interned. `JS_LOCKFILES`/`AUTONOMOUS_BLOCKED_PATHS`/`AUTONOMOUS_PER_TOOL_MAX_CALLS` are
`readonly`/`as const` arrays consumed by reference; the
`NearestRoot([...JS_LOCKFILES], …)` spread at `lsp/server-defs/web-servers.ts:62,79,95,230,246,337`
allocates a fresh array per call, but that is a property of the consumer, not of the
constant, and the arrays are ≤6 entries. No performance finding.

## Step 5 Design, ownership, and boundaries

The unit is well-scoped: one topic per leaf file (`lsp`, `network`, `project`, `server`,
`session`, `tool`) and the barrel is a clean facade. Three design observations, none
blocking:

1. **`JS_LOCKFILES` has two competing sources of truth.** `constants/lsp.ts:1` declares
   `["package-lock.json","bun.lockb","bun.lock","pnpm-lock.yaml","yarn.lock"]` (5 entries,
   no `package.json`), while `lsp/server-defs/shared.ts:53` redeclares an
   identically-named `["package.json","package-lock.json","pnpm-lock.yaml","yarn.lock","bun.lockb","bun.lock"]`
   (6 entries, includes `package.json`, different order). The centralized constant is
   consumed by `web-servers.ts:6,62,79,…` as `NearestRoot` markers, but the local
   `shared.ts` copy is the one used by other server defs. Same name, divergent contents —
   a classic drift trap. Recommended: collapse to the `constants/lsp.ts` list (decide
   deliberately whether `package.json` belongs as a _lockfile_ marker or should live in a
   separate `JS_PROJECT_MARKERS` constant) and delete the `shared.ts` redeclaration.
2. **A comment in `session.ts:4-7` claims a coupling the code does not enforce.** It says
   the global step ceiling "now mirrors the autonomous-mode default so the two caps move
   together", but `GLOBAL_STEP_LIMIT = 500` (`session.ts:8`) and
   `AUTONOMOUS_MAX_STEPS = 500` (`session.ts:47`) are independent literals. Contrast with
   the correctly-aliased `GOAL_TOTAL_STEP_HEADROOM = SUPER_LONG_TOTAL_STEP_HEADROOM`
   (`session.ts:25`). If the intent is "move together", express it as an alias; otherwise
   drop the claim from the comment so a future editor doesn't trust it.
3. **`TOAST_DURATION_LONG_MS` is filed under the wrong topic.** It lives in
   `server.ts:5` but is consumed exclusively by UI/toast call sites
   (`tool/bash-impl.ts:269`, `tool/bash-background.ts:192`, `mcp/impl.ts:655,679`) — none
   in `src/server/`. It is a UI constant mis-shelved in the server file. A `ui.ts` (or
   move to `tool.ts`) would reflect ownership; the value (8000) and behavior are fine.

The `server.ts` file itself is also the one leaf not re-exported by `index.ts` (see
Step 1), which is consistent with "server-only" intent — except that the toast constant
breaks that intent by being consumed outside `src/server/`.

## Step 6 Dead code and hygiene

No empty catches (none possible — no try/catch in the unit). Every exported constant was
confirmed to have ≥1 in-tree consumer this session:

- `tool.ts`: `MAX_DIAGNOSTICS_PER_FILE`/`MAX_PROJECT_DIAGNOSTICS_FILES` →
  `tool/diagnostics.ts:85,87,94`; `MAX_BYTES`/`MAX_LINES` → `tool/truncate.ts:17-18,122-123`
  and via `Truncate.MAX_BYTES`/`Truncate.MAX_LINES` interpolation in
  `tool/bash-impl.ts:246-247` and `tool/registry.ts:357-358`; `DEFAULT_READ_LIMIT`/`MAX_LINE_LENGTH`/
  `MAX_LINE_SUFFIX`/`MAX_BYTES_LABEL` → `tool/read.ts:14,263-299`.
- `network.ts`: all seven consumed — `WEBFETCH_*` → `tool/webfetch.ts:8-10`;
  `BASH_MAX_METADATA_LENGTH` → `tool/bash-impl.ts:51`; `EXA_*` →
  `tool/exa-fetch.ts:2,54,72` and `tool/websearch.ts:4,68`.
- `session.ts`: every constant maps to a live site (compaction, prompt-loop, blast-radius,
  cycle-detection, processor, prompt-impl, prompt-loop-errors, retry).
- `project.ts`: `GITHUB_REPO_URL`, `GITHUB_NEW_ISSUE_URL`, `GITHUB_ACTION_REF`,
  `CONFIG_SCHEMA_URL`, `TUI_SCHEMA_URL`, `INSTALL_SCRIPT_URL`, `HOMEBREW_TAP`,
  `LEGACY_HOMEBREW_TAP`, `HOMEBREW_FORMULA_API_URL`, `GITHUB_LATEST_RELEASE_API_URL`
  all confirmed used.

No unused export, no dead literal. One hygiene nit (not dead code): the truncation
suffix is inconsistent across tools — `read.ts:264` uses the descriptive `MAX_LINE_SUFFIX`
while `grep.ts:123,273` uses a bare `"..."` for the same `MAX_LINE_LENGTH` cut. Logged as
a finding because the whole point of centralizing the suffix was a uniform indicator.

## Step 7 Tests

The MODULE-AUDIT inventory records "none auto-matched" for this unit, and a
`packages/ax-code/test/` scan this session found no file targeting `constants/`
specifically. That is the correct outcome for pure-constant modules: the values are
exercised indirectly through their consumers (truncate/read diagnostics tests,
compaction threshold tests, prompt-loop config tests). The actionable test gap is not
"unit-test the literals" but "add a snapshot/equality assertion that guards the
`JS_LOCKFILES` drift called out in Step 5" — a one-line
`expect(sharedLockfiles).toEqual(constantsLockfiles)` would have caught the divergence at
CI time. No regression test is currently wired for it.

## Step 8 Finding register

| #   | Finding                                                                                                                                                                                                                   | Category                  | Severity | Anchor                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | -------- | ------------------------------------------------------------- |
| C-1 | `JS_LOCKFILES` declared twice with divergent contents (5 vs 6 entries; `package.json` membership differs). Centralized copy in `constants/lsp.ts:1` is undermined by the redeclaration in `lsp/server-defs/shared.ts:53`. | correctness / consistency | MEDIUM   | `constants/lsp.ts:1`; `lsp/server-defs/shared.ts:53`          |
| C-2 | Truncation suffix drift: `MAX_LINE_SUFFIX` (`tool.ts:4`) used by `read.ts:264` but `grep.ts:123,273` hardcodes `"..."` for the same cut.                                                                                  | UX consistency            | LOW      | `constants/tool.ts:4`; `tool/grep.ts:123`; `tool/grep.ts:273` |
| C-3 | `session.ts:4-7` comment claims `GLOBAL_STEP_LIMIT` and `AUTONOMOUS_MAX_STEPS` "move together" but they are independent `500` literals (cf. the correctly-aliased `GOAL_TOTAL_STEP_HEADROOM` at `session.ts:25`).         | comment/code drift        | LOW      | `constants/session.ts:4-8`; `constants/session.ts:47`         |
| C-4 | `TOAST_DURATION_LONG_MS` is a UI concept filed in `server.ts:5` and consumed only outside `src/server/`; also the one leaf not re-exported by the barrel.                                                                 | cohesion / ownership      | LOW      | `constants/server.ts:5`; `constants/index.ts:1-5`             |

No Critical findings. No security, crash, or data-loss exposure was identified — the
unit is side-effect-free and every dangerous-looking value (autonomous caps, blocked
paths) is documented at the declaration site.

## Step 9 Verification and exit

- **Typecheck:** `pnpm --dir packages/ax-code run typecheck` (recursive via `tsgo`) is the
  relevant gate for a pure-constants change; no test in the suite targets this unit
  directly, so `test:scripts` / `test:unit` give no specific signal here.
- **Verification posture:** this pass is read-only analysis (architect role); no source
  bytes were mutated, so no build re-run is required to validate the review itself. The
  recommendations above (collapse `JS_LOCKFILES`, alias or de-claim the step-limit couple,
  relocate the toast constant, share the truncation suffix) are the actionable follow-ups
  for an implementer and should each land with its own verify run.
- **Exit checklist:** 9 steps complete; finding ledger (Step 8) consistent with the
  empty `findings/` directory (no Critical → no `reverify.md` required); independent
  verifier (codex-sol) to countersign.
