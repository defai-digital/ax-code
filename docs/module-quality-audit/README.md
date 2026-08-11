# Module-by-Module Quality Audit Program

Execution hub for the
[Module-by-Module Quality Audit PRD](../../../prd/PRD-2026-08-11-module-by-module-quality-audit.md).
The program audits every in-scope AX Code CLI, Desktop, supporting-package, and
native module as an independently signed-off unit, then closes or explicitly
defers each accepted finding under the PRD's severity policy.

> This directory contains planning and evidence records. Product fixes and tests
> belong in their owning packages. Never copy credentials, private repository
> content, or unredacted user data into an audit record.

## Documents

| Document | Purpose |
|----------|---------|
| [PRD](../../../prd/PRD-2026-08-11-module-by-module-quality-audit.md) | Scope, protocol, severity, evidence, metrics, and acceptance criteria |
| [PHASES.md](./PHASES.md) | Ordered wave checklist, gates, effort, and verification expectations |
| [STATUS.md](./STATUS.md) | Live baseline, metrics, owners, unit states, and report links |
| [templates/MODULE-AUDIT.md](./templates/MODULE-AUDIT.md) | Required per-unit review and sign-off record |
| [templates/FINDING.md](./templates/FINDING.md) | Required accepted/candidate finding record |

## Record layout

Create records as work begins; do not pre-create empty reports for every unit.

```text
module-quality-audit/
  README.md
  PHASES.md
  STATUS.md
  templates/
    MODULE-AUDIT.md
    FINDING.md
  modules/
    <module-slug>/
      MODULE-AUDIT.md
      findings/
        AUDIT-<module-slug>-001.md
```

Module slugs are frozen in Wave 0. Use path-derived, lowercase kebab case:

- `packages/ax-code/src/session` → `session`
- `packages/ax-code/src/provider/cli` → `provider-cli`
- CLI command `tui` → `cli-cmd-tui`
- Desktop Electron IPC → `desktop-electron-ipc`
- `desktop/packages/web/server/lib/event-stream` → `desktop-web-event-stream`
- `crates/ax-code-terminal` → `crate-terminal`

Do not rename a slug after a finding ID has been issued. Record a path move in the
module report and retain the stable slug.

## Start an audit unit

1. In [STATUS.md](./STATUS.md), set the unit to `MAPPING`, add the reviewer and
   start date, and record the baseline commit SHA. One reviewer owns a unit at a time.
2. Create `modules/<module-slug>/MODULE-AUDIT.md` from the module template. Resolve
   every placeholder and confirm scope boundaries before reviewing findings.
3. Map source, tests, public exports, callers/callees, config/persistence, processes,
   and trust boundaries. If the unit is XL, split it into named child reports and add
   those rows to `STATUS.md` before continuing.
4. Complete all nine protocol steps. Searches and automated tools produce
   candidates only; read the source and prove reachability/impact.
5. Create one finding record per candidate that survives initial validation. Allocate
   IDs monotonically; never reuse a rejected or duplicate number.
6. Link prior art. A finding from the 2026-07-19 review uses
   `Origin: prior-review` and is not counted as a new discovery.
7. For accepted findings, add/extend the regression test before or with the smallest
   safe fix. Record exact commands and results in both finding and module reports.
8. Have a different reviewer re-verify every Critical finding and remediation.
9. Resolve accepted findings as `verified-fixed` or policy-compliant `deferred`,
   complete the exit checklist, add sign-offs, and set the status row to `SIGNED OFF`.

## Status rules

Allowed module states:

```text
NOT STARTED
MAPPING
REVIEWING
FINDINGS VALIDATION
FIXING
VERIFYING
BLOCKED
SIGNED OFF
```

- `BLOCKED` must name the dependency and next action; it does not mean deferred risk.
- `DEFERRED` is a finding state, not a module state.
- A module with an open accepted finding is not signed off unless every remaining
  finding has a valid deferral under the severity rubric.
- Any overlapping source change after review requires a delta review before sign-off.
- A final hygiene-sweep hit reopens the owning module until disposition and re-signoff.

Allowed finding states:

```text
candidate → accepted → fixing → verification → verified-fixed
                    ↘ deferred
candidate → rejected | duplicate
```

Allowed primary categories are `security`, `correctness`, `stability`,
`performance`, `design`, `dead-code`, `silent-error`, `quality`, and `test-gap`.

## Prior art and duplicate handling

Read the
[2026-07-19 review](../../reviews/2026-07-19-code-quality-stability-review.md)
lightly during mapping, then verify current code independently. Use these rules:

- still present with the same proof: link it, set `Origin: prior-review`, and count it
  as revalidated prior art, not a new finding;
- fixed before the module baseline: record it in the coverage map only when it informs
  a regression test; do not create an accepted finding;
- same root cause spanning modules: choose one owner and add impacted-module links;
- materially different cause or impact: create a new finding and explain the delta;
- unproven statement: retain as a candidate until current static or dynamic proof exists.

## Review/fix coordination

- Read-only mapping/review may run in parallel on disjoint units.
- Writes to shared hot paths are serialized. The status row names the active fixer.
- Critical containment may interrupt the current wave; document the gate decision.
- A reviewer may validate their own ordinary finding, but Critical verification must
  be independent. Prefer independent re-verification for High security findings too.
- Cross-unit findings have one canonical record and one closure decision.

## Verification baseline

Use focused commands first and the required package/wave gates afterward. Never run
the intentionally failing root `pnpm test` command.

```bash
pnpm run typecheck
pnpm --dir packages/ax-code run typecheck
pnpm --dir packages/ax-code run test:unit
pnpm --dir packages/ax-code run test:deterministic
pnpm --dir packages/ax-code run test:e2e
pnpm --dir packages/ax-code run test:recovery

pnpm run check:desktop-boundaries
pnpm run desktop:typecheck
pnpm run desktop:lint
pnpm run desktop:test
pnpm run desktop:build

pnpm --dir packages/sdk/js run build
pnpm --dir packages/sdk/js test
pnpm run test:scripts
pnpm build:native:debug
pnpm run check:structure
```

Exact core test targeting:

```bash
cd packages/ax-code
AX_TEST_FILES=test/<domain>/<file>.test.ts pnpm exec vitest run
```

Exact Desktop test targeting:

```bash
pnpm --dir desktop exec vitest run <file>
```

Record skipped gates and reasons. A passing unrelated broad suite does not replace a
regression test that exercises the accepted finding.

## Metric cadence

Update `STATUS.md` at least weekly, at every wave gate, and whenever a Critical or
High finding changes state. The update must refresh:

- audited and signed-off numerator/denominator;
- Critical/High open, closed, overdue, and independently verified;
- silent-catch and unhandled-rejection baselines/deltas;
- high-risk test coverage or invariant-path deltas;
- relevant performance baselines/results;
- boundary, typecheck, generated-drift, and package-gate health; and
- deferrals due or expired.
