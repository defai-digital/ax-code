# Protocol Steps: agent

- Slug: `agent`
- Lane: `codex-sol`
- Date: `2026-08-11`

## Step 1 Scope and interfaces

The `agent` unit has two implementation surfaces: `packages/ax-code/src/agent/agent.ts:31-511` defines agent metadata, built-in/configured agents, selection, and generation, while `packages/ax-code/src/agent/router.ts:235-342` exposes keyword routing and optional model-backed complexity classification. The runtime integration is `packages/ax-code/src/session/prompt-routing.ts:28-80`, which conditionally switches to an existing specialist and then obtains complexity. Configuration enters through `packages/ax-code/src/config/schema-impl.ts:244-335`, including legacy tool and `maxSteps` normalization.

## Step 2 Security and failure boundaries

Agent permissions are the principal security boundary. Defaults ask before `.env` reads and unknown external directories (`packages/ax-code/src/agent/agent.ts:85-101`), the explorer starts deny-all and receives only named read/web capabilities (`packages/ax-code/src/agent/agent.ts:109-128`), and subagents receive explicit `task`/`task_parallel` denial (`packages/ax-code/src/agent/agent.ts:197-223`). Because permission evaluation selects the last matching rule (`packages/ax-code/src/permission/evaluate.ts:9-14`), the merge order deliberately lets user configuration override built-in defaults. Agent generation sends the supplied description and optional username telemetry to the selected provider only when invoked (`packages/ax-code/src/agent/agent.ts:465-503`); the description is bounded only by the provider call, so callers remain responsible for avoiding sensitive prompt content.

## Step 3 State and control-flow correctness

Per-instance initialization loads config and skill directories before constructing policies, loads named policy files concurrently, applies configuration overrides, and then restores the truncate-directory exception unless explicitly denied (`packages/ax-code/src/agent/agent.ts:79-153`, `packages/ax-code/src/agent/agent.ts:360-410`). Default selection rejects absent, subagent, and internal configured defaults and otherwise chooses a visible core/specialist (`packages/ax-code/src/agent/agent.ts:428-444`). One Low API-contract concern remains: the map lookup can return `undefined` (`packages/ax-code/src/agent/agent.ts:412`), and this behavior is asserted at `packages/ax-code/test/agent/agent.test.ts:445-452`, but `State.get` and public `Agent.get` claim a non-optional `Agent.Info` at `packages/ax-code/src/agent/agent.ts:73-76,453-455`. Consumers frequently guard the value, but the signature can mislead new callers.

## Step 4 Cost and bounded work

`Instance.state` amortizes configuration and policy construction, and policy reads are parallelized with `Promise.all` (`packages/ax-code/src/agent/agent.ts:79-80,147-151`). Listing sorts a small in-memory collection (`packages/ax-code/src/agent/agent.ts:414-425`). Keyword routing scans a fixed rule table, though `matchesKeyword` recompiles a regular expression for each keyword on every message (`packages/ax-code/src/agent/router.ts:230-232,249-268`); the table size makes this bounded, but precompilation would remove hot-path allocation if routing expands. Complexity input is capped at 500 characters and generation is aborted after 1.5 seconds (`packages/ax-code/src/agent/router.ts:283-285,316-327`). Provider/model discovery occurs before that timer, so the timeout covers the model request rather than all classifier setup.

## Step 5 Ownership and composition

The split is coherent: `agent.ts` owns catalog/policy assembly, `router.ts` owns pure topic scoring plus complexity classification, and `prompt-routing.ts` owns session effects such as recorder events and toast publication (`packages/ax-code/src/session/prompt-routing.ts:43-79`). Tier resolution is centralized at `packages/ax-code/src/agent/agent.ts:63-71` and reused by selection and task exposure (`packages/ax-code/src/tool/task.ts:95-108`). The router does not verify target existence; the integration performs that check before switching (`packages/ax-code/src/session/prompt-routing.ts:44-75`), keeping the scorer independent of instance state.

## Step 6 Maintenance and defensive behavior

Both classifier failure and timeout paths return a nullable result and clear their timer (`packages/ax-code/src/agent/router.ts:316-337`); error formatting delegates to the shared safe conversion helper (`packages/ax-code/src/agent/router.ts:340-342`). Internal agents cannot be disabled, while disabling a core agent emits a warning (`packages/ax-code/src/agent/agent.ts:360-369`). The assignment `result.identifier = result.identifier` at `packages/ax-code/src/agent/agent.ts:503-505` is a harmless no-op and can be removed. More importantly, generated identifiers are sanitized and length-limited at `packages/ax-code/src/agent/agent.ts:504-509`, but there is no post-sanitization non-empty check; this is best covered before treating generated names as durable configuration.

## Step 7 Test evidence and gaps

The focused suite exercises default permissions, overrides, disabling, sorting, tier fallback, default-agent rejection, truncate/skill-directory access, and unsafe step counts throughout `packages/ax-code/test/agent/agent.test.ts:19-838`. Router tests cover every specialist, false-positive regressions, precedence, self-routing, feature gating, and defensive error formatting (`packages/ax-code/test/agent/router.test.ts:6-154`). Missing focused cases are `Agent.generate` sanitizing an all-invalid identifier and colliding with an existing 50-character identifier, plus mocked classifier success, provider-resolution rejection, and abort behavior. The current tests intentionally document the optional `Agent.get` runtime result but cannot expose its inaccurate TypeScript return contract.

## Step 8 Finding disposition

The unit ledger currently records no accepted finding at `docs/module-quality-audit/modules/agent/MODULE-AUDIT.md:74-78`, and `docs/module-quality-audit/modules/agent/findings/` contains no finding files. This pass found no Critical or High severity issue, so no secondary Critical confirmation file is required. The optional-return signature mismatch described in Step 3 is a Low contract issue, while the generation edges in Step 6 are defensive-validation and coverage gaps; they are recorded here because the requested output is limited to the three protocol artifacts.

## Step 9 Executed verification

`AX_TEST_FILES=test/agent/agent.test.ts,test/agent/router.test.ts pnpm --dir packages/ax-code exec vitest run` passed both files and all 63 tests. `pnpm --dir packages/ax-code run typecheck` also completed successfully. These checks validate current runtime expectations at `packages/ax-code/test/agent/agent.test.ts:32-838` and keyword/complexity behavior at `packages/ax-code/test/agent/router.test.ts:6-154`; the successful typecheck also confirms that the `as Agent.Info` assertion at `packages/ax-code/src/agent/agent.ts:412` currently masks, rather than resolves, the optional lookup contract.
