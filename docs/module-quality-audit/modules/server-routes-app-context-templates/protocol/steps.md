# Protocol Steps — server-routes-app-context-templates

Unit: `server-routes-app-context-templates`
Primary source: `packages/ax-code/src/server/routes/app-context-templates.ts` (117 lines, 2 exports)
Reviewer: ax-code-glm (model `zai-coding-plan/glm-5.2[1m]`); independent verifier: codex-sol.

## Step 1 Scope and map

The unit is a single pure-TypeScript module with two named exports. `contextTemplates` is defined at `packages/ax-code/src/server/routes/app-context-templates.ts:8` and returns a list of four static `AppContextTemplateData` entries (`repo-rules`, `review-checklist`, `frontend-style-guide`, `release-checklist`) defined inline at lines 9-38, conditionally splicing a fifth `dir-rules` entry at index 1 when `path.resolve(input.dir) !== path.resolve(input.root)` (line 40-48). `templateBody` is defined at line 53 and switches over `input.key` to return markdown bodies for the five known keys (lines 54-116). The shape `AppContextTemplateData` and the key union `AppContextTemplateKey` are imported from `packages/ax-code/src/server/routes/app-context-schema.ts:2` (`app-context-schema.ts:49-51`). The only consumer inside the server layer is `packages/ax-code/src/server/routes/app-context.ts` (import at line 13, use at lines 66 and 106/114). No IO, no network, no async; this is a data/template helper.

## Step 2 Threat and failure model

The module is pure and performs no filesystem, network, or subprocess work itself, so the `network, api` risk tags on the unit trace to the consumer route `app-context.ts`, not to this file. The interesting failure modes here are (a) a future maintainer extending the `AppContextTemplateKey` zod enum at `app-context-schema.ts:19` without adding a matching case to the `templateBody` switch, which would silently return `undefined`; (b) the `dir-rules` path being computed from caller-supplied `input.dir` at `app-context-templates.ts:45` (`path.join(input.dir, "AGENTS.md")`) — the caller (`app-context.ts:103-104`) derives `root`/`dir` from `Instance.worktree`/`Instance.directory`, so this is not request-body controlled at this layer; (c) order-coupling: the `splice(1, 0, …)` at line 41 hard-codes that `dir-rules` always sits between `repo-rules` and `review-checklist`. No empty catches, no secrets, no inline URLs in this file.

## Step 3 Correctness

Reading the control flow: `contextTemplates` builds the array literal at lines 9-38 with `kind` and `key` literals cast via `as const`, matching the zod enum in `app-context-schema.ts:19` and `kind` enum at `app-context-schema.ts:24`. The conditional insert at line 40 uses `path.resolve` on both sides, correctly normalizing relative/symlinked `dir` and `root` before comparison, so `dir === root` (the common case in tests like `app-context-routes.test.ts:13`) correctly suppresses the `dir-rules` entry. `templateBody` returns the `# Project Instructions` body for `repo-rules` (lines 56-71), which is exactly what the integration test asserts at `test/server/app-context-routes.test.ts:117` (`expect(await fs.readFile(expectedPath, "utf-8")).toContain("# Project Instructions")`). The `relativeFromRoot` helper at line 4-6 is used at line 76 with the `|| "."` fallback so the `Scope:` line is never empty when `dir === root` — but note that branch is only reachable when `dir !== root` because `templateBody` does not re-check; if a caller invokes `templateBody({ key: "dir-rules", root, dir: root })` directly the body still renders with `Scope: "."`, which is benign.

## Step 4 Performance

No hot path. `contextTemplates` allocates a ≤5-element array of plain object literals; `templateBody` returns a single joined string per call. The consumer at `app-context.ts:66` calls `contextTemplates(...)` once per `GET /context` request and at `app-context.ts:106` once per `POST /context/template`. Both are user-triggered, low-frequency endpoints. The `path.resolve`/`path.join` calls (lines 14, 21, 28, 35, 40, 45) are O(1) string work. No N+1, no allocation in a loop, no async. Nothing to optimize.

## Step 5 Design

The two functions are appropriately small and side-effect free, which makes them trivially testable from the route layer. Two observations worth noting (neither blocks sign-off): (1) `templateBody`'s switch has no `default` branch and no `: never` exhaustiveness guard, so the TypeScript signature implicitly allows `undefined` to be returned if the union widens; tying the switch to the `AppContextTemplateKey` union via a `assertNever(input.key)` default would catch a schema/impl drift at compile time. (2) The five template bodies and their metadata live in two parallel switches/arrays keyed by the same literals (`repo-rules` at lines 11 and 55, `dir-rules` at lines 42 and 72, etc.) — a single `Record<AppContextTemplateKey, { data; body }>`, would co-locate metadata and body and remove the index-1 `splice`. For a 5-item static catalog this is borderline over-engineering; flagging only as a future tidy-up, not a required change.

## Step 6 Dead code and duplication

No unreachable code. The `relativeFromRoot` helper (lines 4-6) is called exactly once at line 76; inlining would save two lines but the named helper documents intent, so I would keep it. The five case bodies in `templateBody` share the `[...].join("\n")` shape but contain distinct prose content, so `dedup_scan` would (correctly) not flag them as duplicated logic. The `as const` casts on `key`/`kind` at lines 11/15/18/22/etc. are redundant given the `AppContextTemplateData` type annotation on `list`, but they are harmless and match the codebase's defensive style. No TODO/FIXME markers in the file.

## Step 7 Tests

Direct unit coverage of `contextTemplates` and `templateBody` does not exist — `grep` for those symbols under `packages/ax-code/test` returns no hits. Indirect coverage exists through `packages/ax-code/test/server/app-context-routes.test.ts`: the `GET /context` test at line 12 asserts `repo-rules` appears in the template list (line 39), and the `POST /context/template` test at lines 98-118 creates a `repo-rules` template and asserts the file body contains `# Project Instructions` (line 117), which round-trips `contextTemplates().find(...)` → `templateBody("repo-rules")` → `Filesystem.write`. Gaps: no assertion that `dir-rules` appears only when `dir !== root`, and no coverage of the `review-checklist`, `frontend-style-guide`, `release-checklist`, or `dir-rules` body strings. These are low-risk gaps because the bodies are static string literals, but a single parameterized test enumerating all five keys would lock in the contract against the schema enum.

## Step 8 Finding register

No Critical or High-severity findings for this unit. Two informational notes recorded in this protocol only (not in `findings/`): (N1, LOW) `templateBody` lacks an exhaustiveness/default branch — recommend a `default: return assertNever(input.key)` guard so future enum additions fail at compile time; (N2, LOW) parallel metadata/body switches keyed by the same literals could be co-located, but the current shape is acceptable for a five-item static catalog. Both are non-blocking and do not require a `findings/` file. The `findings/` directory is empty and consistent with this register.

## Step 9 Verification and exit

Re-read evidence paths before closing: `packages/ax-code/src/server/routes/app-context-templates.ts:8-51` (contextTemplates), `:53-116` (templateBody), `:40` (dir!==root guard), `:76` (relativeFromRoot with `|| "."` fallback); schema source `packages/ax-code/src/server/routes/app-context-schema.ts:18-25,49-51`; consumer `packages/ax-code/src/server/routes/app-context.ts:66,106,114`; integration test `packages/ax-code/test/server/app-context-routes.test.ts:39,98-117`. Static analysis fingerprint from MODULE-AUDIT is `6d7299ae7f540cea` against baseline `046510f0ca8a215f632e99fa92aa0633d684cbb9`. Verification scope for this unit is `pnpm --dir packages/ax-code run typecheck` plus `packages/ax-code/test/server/app-context-routes.test.ts` via `AX_TEST_FILES=test/server/app-context-routes.test.ts`. Conclusion: unit passes the 9-step protocol with two LOW informational notes; ready for codex-sol independent verification.
