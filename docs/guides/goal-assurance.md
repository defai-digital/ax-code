# Goal assurance

Status: Current
Scope: Goal acceptance checks and source freshness
Last reviewed: 2026-09-08
Owner: AX Code runtime maintainers

Code-change plans produced by the goal planner declare executable acceptance
checks. Each check names the outcome it covers, its exact command, its purpose,
and the intended environment. AX Code records execution evidence when the agent
runs `verify_project` with the check's `goalCheck` id.

```json
{ "goalCheck": "invoice-parity" }
```

The command comes from the frozen goal plan. The agent cannot replace it with a
different command through this call. Existing bash permissions still apply.
Completing the goal requires every declared check's latest attempt to pass with
matching goal, session, workspace, contract and source content. Acceptance prose
explains the result; it does not replace executed checks. Ordinary shell runs and
checks that were entirely skipped cannot supply this evidence.

Old goal plans without assurance retain their earlier completion rules. Clear and
recreate an old goal when you need the new contract; editing its frozen requirements
in place causes a contract mismatch. A fork preserves the contract but requires
fresh check runs in the new session.

## Preparing a migration project

Provide authoritative legacy source or exports with revision identifiers, a bounded
coverage inventory, and check scripts that fail when assertions cannot be verified.
Treat comments and earlier migration implementations as leads to investigate.
Record approved behavior changes separately from legacy parity requirements.

Select checks for the layers the requested change actually affects:

| Layer           | What a project check should assert                                                                |
| --------------- | ------------------------------------------------------------------------------------------------- |
| Business flow   | Same inputs, roles and starting data produce the required outputs and side effects.               |
| Database logic  | Required objects, triggers, procedures and jobs exist and exhibit the expected behavior.          |
| Schema and data | Mappings, constraints, defaults and reconciliation rules hold; row counts alone are insufficient. |
| Configuration   | Relevant configuration branches exercise the intended behavior.                                   |
| Deployment      | The intended instance, schema, artifact revision and effective configuration are actually active. |

Scripts must assert the target identity before performing their checks. Keep
credentials in the project's existing credential mechanism, never in plan text,
commands or target descriptions. A check should return a nonzero exit code for a
failed assertion, missing environment or skipped required assertion. Avoid wrappers
that mask failures. AX Code cannot infer assertions from a successful process exit.

For large migrations, organize work into bounded business-flow batches and maintain
an inventory linking forms, dependencies, legacy references and acceptance checks.
Report both the accepted batch and remaining coverage. Passing one batch does not
complete the entire migration.

## What a plan records

The planner supplies an `assurance` object. This illustrative fragment assumes the
project has the referenced source export and check script:

```json
{
  "version": 1,
  "sourcePaths": ["src", "checks", "package.json"],
  "sources": [
    { "role": "legacy", "reference": "legacy/invoice-schema.sql at export-v1" },
    { "role": "requirement", "reference": "Invoice acceptance criteria supplied by the user" }
  ],
  "checks": [
    {
      "id": "invoice-parity",
      "acceptanceIds": ["AC1"],
      "command": "node checks/invoice-parity.cjs",
      "purpose": "Assert invoice behavior, database mappings and target identity",
      "environment": "Staging migration target, schema ERP"
    }
  ]
}
```

All acceptance ids must be covered. Commands execute from the workspace root.
The assurance object is frozen with the acceptance contract. The agent receives
validated scope, source references, check ids and declared targets in its continuing
goal context. Missing or altered contracts produce a restore notice. Generated
conversation summaries remain fallible; declared references and target labels
are requirements, not independently observed facts.

## Freshness and limits

Git source fingerprints include actual bytes of tracked and nonignored untracked
files within the declared `sourcePaths`. Explicit file paths also include ignored
configuration files; directory paths retain Git ignore rules. Mutable goal-plan checklists are excluded; their frozen requirements are
checked through the contract digest. Non-Git projects recursively fingerprint declared
`sourcePaths`, including missing paths. Include every relevant source, configuration
file and check script in that scope.

Fingerprinting is limited to 20,000 entries and 128 MiB of file content. Linked
source, nested Git repositories, special files, escaping paths, changing files and
unavailable reads cannot produce fresh evidence. Such failures block assured
completion. Check output artifacts should go to an ignored location so producing
a report does not change the source being verified.

Ignored files not explicitly named, dependencies outside the source scope, databases and deployments
need assertions in the project command. A receipt records an observation at its
execution time; it does not prove external state has remained unchanged. Rerun
affected checks after changing configuration, databases or deployments. AX Code
does not automatically discover all legacy behavior or certify migration parity.
