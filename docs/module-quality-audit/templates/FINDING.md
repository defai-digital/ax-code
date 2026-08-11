# `<AUDIT-module-slug-NNN>`: `<concise finding title>`

| Field | Value |
|-------|-------|
| ID | `AUDIT-<module-slug>-NNN` |
| Module | [`<module-slug>`](../MODULE-AUDIT.md) |
| Primary category | `<security/correctness/stability/performance/design/dead-code/silent-error/quality/test-gap>` |
| Secondary tags | `<optional comma-separated tags>` |
| Severity | `<Critical/High/Medium/Low/Nit>` |
| Status | `candidate` |
| Origin | `<new/prior-review/incident/test/scan/other>` |
| Reporter / owner | `<reporter>` / `<fix owner or unassigned>` |
| First observed | `<full commit SHA>` on `YYYY-MM-DD` |
| Source | `<repo-relative path:start-end>` |
| Impacted units | `<links or none>` |
| Target / expiry | `<SLA date or deferral expiry>` |
| Fix / test | `<commit/PR links or pending>` |
| Independent verifier | `<required for Critical; recommended for High security>` |

> Keep the ID forever once allocated. Rejected and duplicate IDs are not reused.
> Remove all placeholders before moving this finding to `accepted`.

## Summary

`<One paragraph: what invariant is violated, under what reachable condition, and
what user/system consequence follows. Avoid solution-first wording.>`

## Evidence

### Source and control/data flow

- Reviewed commit: `<full SHA>`
- Primary location: `<path:start-end and symbol>`
- Callers/entrypoint: `<path:symbol>`
- Failure sink/observable result: `<path:symbol>`

Static proof:

1. `<Trace input/state from reachable entrypoint.>`
2. `<Show missing/incorrect guard, invariant transition, race, or resource path.>`
3. `<Show resulting behavior and why an existing defense does not prevent it.>`

### Reproduction or failing test

Preconditions/environment:

```text
<OS/runtime/config/fixtures; redact secrets>
```

Commands/actions:

```bash
<minimal deterministic reproduction or exact failing test command>
```

Expected:

```text
<required behavior>
```

Observed:

```text
<actual behavior, exit status, sanitized log, trace, or benchmark result>
```

If dynamic reproduction is unsafe or infeasible: `<why, plus complete static proof
or safe negative harness used instead>`.

## Impact and severity

- Affected users/systems: `<who/what>`
- Reachability/frequency: `<normal, edge, adversarial, platform/config dependent>`
- Blast radius: `<single operation/session/project/process/install/release/etc.>`
- Data/security/recovery consequence: `<specific outcome and recoverability>`
- Workaround/containment: `<available or none>`
- Severity rationale: `<apply the PRD rubric; fix size is irrelevant>`

SLA calculation: `accepted YYYY-MM-DD` → target `<date>`; pauses/exception:
`<none or approved reason>`.

## Root cause and violated invariant

Required invariant:

> `<Write one testable invariant.>`

Root cause: `<implementation/design cause, not merely the symptom>`

Prior-art lineage or duplicate analysis: `<link and delta, or none>`

## Recommended fix

### Minimal approach

1. `<targeted code/policy change>`
2. `<regression or negative test>`
3. `<migration/rollout/telemetry or none>`

Why this is the smallest safe change: `<reason>`

### Alternatives considered

| Alternative | Benefit | Cost/risk | Decision |
|-------------|---------|-----------|----------|
| `<alternative>` | `<benefit>` | `<cost>` | `<reject/defer/select and why>` |

Compatibility, migration, rollback, and cross-module effects:
`<details or none>`

## Test and verification plan

### Regression test

- Test path/name: `<path:test name>`
- Before fix: `<how it fails or why test-first cannot be committed>`
- After fix: `<required assertion>`
- Negative/adversarial cases: `<security/error/boundary cases>`

### Commands

```bash
<exact focused test>
<affected typecheck/package tests>
<boundary/build/generated/native checks as applicable>
```

For performance findings:

| Metric | Environment/workload | Before | Required threshold | After | Repetitions/variance |
|--------|----------------------|--------|--------------------|-------|----------------------|
| `<metric>` | `<details>` | `<value>` | `<target>` | `<value>` | `<details>` |

## Resolution record

| Event | Date | Actor | Evidence/notes |
|-------|------|-------|----------------|
| Candidate created | `YYYY-MM-DD` | `<name>` | `<source/proof>` |
| Accepted/rejected/duplicate | `YYYY-MM-DD` | `<name>` | `<rationale>` |
| Fix ready | `YYYY-MM-DD` | `<name>` | `<commit/PR>` |
| Verification complete | `YYYY-MM-DD` | `<name>` | `<commands/results>` |
| Closed/deferred | `YYYY-MM-DD` | `<name>` | `<final status>` |

### Verification result

- Source re-read at fix commit: `<SHA and paths>`
- Regression command/result: `<exact result>`
- Package/wave gates: `<results>`
- Residual risk: `<none or explicit>`

### Independent Critical verification

Required for Critical findings and their remediations:

- Verifier: `<different reviewer>`
- Independent source/reproduction proof: `<evidence>`
- Fix bypass/negative testing: `<evidence>`
- Verdict/date: `<confirmed/rejected/reopened>` on `YYYY-MM-DD`

## Deferral (complete only when status is `deferred`)

- Why a verified fix cannot land now: `<rationale>`
- Interim mitigation/disabled exposure: `<specific control>`
- Residual risk accepted by: `<named approver>`
- Owner: `<name>`
- Review/expiry date: `YYYY-MM-DD`
- Trigger for reopening: `<event/threshold>`
- ADR: `<link only if decision-level; otherwise N/A>`

