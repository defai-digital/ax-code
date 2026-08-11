# Nine-step review: permission

## Step 1 Scope and public surface

The `permission` unit separates command-prefix extraction, rule matching, orchestration, risk classification, and branded IDs. `packages/ax-code/src/permission/arity.ts:1-9` exports `BashArity.prefix`; `packages/ax-code/src/permission/evaluate.ts:9-14` exports the pure matcher; `packages/ax-code/src/permission/index.ts:26-83` defines the schemas and bus events; `packages/ax-code/src/permission/risk-classes.ts:74-77` classifies permission names; and `packages/ax-code/src/permission/schema.ts:1-5` owns `PermissionID`. The inventory in `docs/module-quality-audit/modules/permission/MODULE-AUDIT.md:24-30` agrees with these source boundaries.

## Step 2 Trust boundaries and abuse cases

Repository-controlled `.ax-code/policy.json` is the highest-risk input. `packages/ax-code/src/permission/index.ts:599-611` converts its agent/tool/file entries into ordinary rules, while `packages/ax-code/src/permission/index.ts:615-640` admits all actions only behind `ProjectConfigTrust.enabled()` and otherwise returns deny actions alone. The opt-in is environment-only at `packages/ax-code/src/config/project-config-trust.ts:1-12`, so a checkout cannot declare itself trusted. Separately, `packages/ax-code/src/permission/index.ts:201-210` makes isolation escalation and destructive bash interactive-only, and `packages/ax-code/src/runtime/headless/projection.ts:110-119` preserves those prompts in autonomous headless mode.

## Step 3 Rule ordering and request lifecycle

Rule precedence is explicit: `packages/ax-code/src/permission/evaluate.ts:9-14` flattens rulesets, selects the last wildcard match, and defaults to `ask`. In `packages/ax-code/src/permission/index.ts:299-318`, every requested pattern is evaluated, any deny throws immediately, and an interactive-only permission cannot escape through an allow rule. Pending requests are inserted before the asked event at `packages/ax-code/src/permission/index.ts:369-400`, then removed on abort or settlement at `packages/ax-code/src/permission/index.ts:379-415`. Reply handling rejects all same-session requests on user rejection (`packages/ax-code/src/permission/index.ts:446-454`) but applies `once` only to the selected request (`packages/ax-code/src/permission/index.ts:456-461`).

## Step 4 Safety and autonomous behavior

Safety evaluation precedes both configured rules and autonomous shortcuts at `packages/ax-code/src/permission/index.ts:251-303`. In autonomous mode, a protected-path denial for a non-safe class becomes `DeniedError` at `packages/ax-code/src/permission/index.ts:260-296`; safe permissions may return early, risk permissions require rules or a prompt, and unknown names prompt unless the explicit compatibility setting disables strictness (`packages/ax-code/src/permission/index.ts:320-364`). Full-access risk auto-approval occurs only after explicit rule denial has already been checked at `packages/ax-code/src/permission/index.ts:305-345`. The risk table covers actual process/network/write capabilities at `packages/ax-code/src/permission/risk-classes.ts:60-72`, including the emitters at `packages/ax-code/src/tool/monitor.ts:65-74` and `packages/ax-code/src/tool/image_gen.ts:107-112`.

## Step 5 Persistence and concurrency

Per-project state loads approvals by project ID at `packages/ax-code/src/permission/index.ts:181-191` and rejects unresolved deferred requests during disposal at `packages/ax-code/src/permission/index.ts:193-198`. `always` replies are serialized inside an instance at `packages/ax-code/src/permission/index.ts:212-224`; persistence also takes a database-path file lock and rereads the latest row inside a transaction at `packages/ax-code/src/permission/index.ts:463-496`, preventing same-process and cross-process lost updates. Matching pending asks are resolved only within the originating session at `packages/ax-code/src/permission/index.ts:504-526`. The focused concurrency assertions are at `packages/ax-code/test/permission/next.test.ts:1049-1099`.

## Step 6 Performance and resource use

The hot matcher is linear in total rule count because `packages/ax-code/src/permission/evaluate.ts:10-13` allocates one flattened list and scans backward. Command arity performs a bounded descending prefix search at `packages/ax-code/src/permission/arity.ts:2-9`; command token lists are small, so its repeated slice/join work is acceptable. Wildcard regex compilation is cached and capped at 500 entries at `packages/ax-code/src/util/wildcard.ts:3-17`, limiting growth under attacker-controlled patterns. Pending entries are explicitly deleted on abort, reply, and final settlement (`packages/ax-code/src/permission/index.ts:379-415`, `446-464`), so the reviewed lifecycle has no orphaned-map retention path.

## Step 7 Maintainability and hygiene

The small pure modules keep policy mechanics testable, while `Permission` remains the integration owner for instance state, events, persistence, and config conversion. The three catches have visible outcomes: serialization falls back to a sentinel at `packages/ax-code/src/permission/index.ts:106-121`, failed persistence rejects the caller and rethrows at `packages/ax-code/src/permission/index.ts:472-500`, and policy loading distinguishes missing, other filesystem, and malformed-file cases at `packages/ax-code/src/permission/index.ts:635-647`. `disabled()` documents and implements its UI-level wildcard-deny semantics at `packages/ax-code/src/permission/index.ts:652-668`. No TODO, FIXME, debug console, or swallowed catch was found in the five unit sources.

## Step 8 Test evidence and findings

Tests exercise default-ask and last-match precedence at `packages/ax-code/test/permission/next.test.ts:210-274`, untrusted deny-only policy plus explicit external trust at `packages/ax-code/test/permission/next.test.ts:309-340`, persistent/concurrent approvals at `packages/ax-code/test/permission/next.test.ts:1006-1099`, and abort cleanup/events at `packages/ax-code/test/permission/next.test.ts:1567-1684`. Arity edges are covered at `packages/ax-code/test/permission/arity.test.ts:4-32`, and task wildcard behavior at `packages/ax-code/test/permission-task.test.ts:20-71`. `AUDIT-permission-001` is Critical and marked verified-fixed at `docs/module-quality-audit/modules/permission/findings/AUDIT-permission-001.md:3-18`; its deny-only invariant is supported by current source and the independent second-pass evidence in `protocol/reverify.md`.

## Step 9 Verification and exit decision

On 2026-08-11, `AX_TEST_FILES=test/permission/next.test.ts,test/permission/risk-classes.test.ts,test/permission/arity.test.ts,test/permission-task.test.ts pnpm exec vitest run` completed with 4 files and 125 tests passing. `pnpm --dir packages/ax-code run typecheck` also exited 0. The reviewed implementation contains no unresolved Critical behavior, and no production source change was needed. The generated protocol follows the current assignment of `codex-sol` as primary reviewer and `ax-code-glm` as verifier; the older role labels still visible at `docs/module-quality-audit/modules/permission/MODULE-AUDIT.md:12-16` were not changed because this task authorizes only protocol artifacts.
