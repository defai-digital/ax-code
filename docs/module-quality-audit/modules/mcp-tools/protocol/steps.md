# mcp-tools — 9-step review (ax-code-glm)

Unit slug: `mcp-tools`
Reviewer: ax-code-glm
Model: zai-coding-plan/glm-5.2[1m]
Baseline commit (from MODULE-AUDIT): `5fefa00cdc847667d3ba3d38509a751498ee4180`
Primary sources (read in full):

- `packages/ax-code/src/mcp/permission-pattern.ts` (162 lines)
- `packages/ax-code/src/mcp/templates/index.ts` (223 lines)
- `packages/ax-code/src/mcp/tool-conversion.ts` (125 lines)

Supporting files I opened to trace consumers and the shared redaction policy:
`packages/ax-code/src/mcp/index.ts`, `packages/ax-code/src/mcp/impl.ts` (lines 1040–1151),
`packages/ax-code/src/session/prompt-tools.ts` (lines 475–509), `packages/ax-code/src/util/env.ts`
(`SECRET_PATTERN` at line 8, `isSensitiveName` at line 102), and the four test files
`test/mcp/permission-pattern.test.ts`, `test/mcp/tool-conversion.test.ts`,
`test/mcp/templates.test.ts`, `test/mcp/permission-contract.test.ts`.

## Step 1 Scope and ownership map

The `mcp-tools` unit is three source files covering distinct, non-overlapping responsibilities.
`permission-pattern.ts` exposes a single namespace `McpPermissionPattern` (declared at line 92) with
one public function `derive` (line 100) plus the `Result` type (line 93). It does **not** execute
tools; it inspects an MCP tool's call args and emits permission-approval patterns plus a redacted
metadata blob. Its sole consumer is the runtime tool wrapper at
`session/prompt-tools.ts:488` (`McpPermissionPattern.derive(key, args, { worktree: Instance.worktree })`),
whose output flows directly into `ctx.ask({ patterns, always, metadata })` at `prompt-tools.ts:489–497`.
`templates/index.ts` is a static catalog: 14 `McpTemplate` entries (lines 23–166) plus four pure
helpers `byCategory` (171), `find` (183), `names` (190), `toConfig` (206). It owns no state and is
consumed by the `cli-cmd-mcp` add-flow (not in this unit's source set). `tool-conversion.ts` exports
seven symbols: `sanitizeMcpName` (14), `mcpItemKey` (18), `mcpToolPermissionKey` (22),
`resolveMcpToolPermissionKeys` (33), `mcpSchemaByteLength` (75), `convertMcpTool` (83), and the
`McpToolIdentity` type (26). Its consumers live in `mcp/impl.ts` (import at line 30/33): the tools()
cache builder calls `resolveMcpToolPermissionKeys` at `impl.ts:1057` and `convertMcpTool` at
`impl.ts:1067`, and `listAllTools()` calls the resolver again at `impl.ts:1149`. No file in this unit
imports from another file in this unit — each is independent. Total public exports: 12 (matches the
audit's "17 exports" only when re-exported aliases in impl.ts are counted; the in-unit surface is 12).

## Step 2 Threat and failure model

The unit is tagged `security` in MODULE-AUDIT and the real security-relevant surface is the
permission-pattern derivation, because its output decides whether a tool call can be auto-approved
without re-prompting. Three assets to defend: (a) the `durable` flag — if a dangerous pattern is
wrongly marked durable it lands in `always` and skips the confirmation gate; (b) secret leakage into
the pattern/metadata strings, which are surfaced to the user and may be persisted; (c) the
permission-key namespace — if two distinct tools collapse to the same key, a deny/allow rule aimed at
one could bind the other. The unit handles all three conservatively: `durable` requires **every**
candidate to be durable (`permission-pattern.ts:149`, an `every` over `selected`), so a single
external path or unknown arg flips the whole result non-durable and falls back to `["*"]` (line 148).
Secret redaction is layered — URL credentials and sensitive query params are rewritten at
`normalizeUrl` (lines 32–45), and any arg key matching the global `SECRET_PATTERN`
(`/KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|AUTH/i`, `env.ts:8`) is replaced with `[redacted]`
both in pattern derivation (line 124) and in `summarizeArgs` (line 74). The one trust boundary worth
naming explicitly: MCP servers are user-configured processes, so `mcpTool.inputSchema` and call args
are semi-trusted — `convertMcpTool` defends size (64 KiB cap at `tool-conversion.ts:93–96`) and
serializability (`mcpSchemaByteLength` throws on circular/bigint at 75–81) but does not deep-validate
schema semantics, which is acceptable given the server is locally installed by the user.

## Step 3 Correctness of public control flow

I traced `McpPermissionPattern.derive` (line 100) end to end. Repo detection (105–111) emits
`repo:owner/repo` when both fields exist, or accepts a pre-slashed `repo` string via the regex
`/^[^/\s]+\/[^/\s]+$/` (line 109) — the regex correctly rejects embedded whitespace and extra slashes.
Database/schema/table (113–121) composes `db:database.schema.table` when `schema` is present else
`db:database.table`. The generic key sweep (123–144) normalizes each key with
`key.replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase()` (line 127) before matching the `URL_KEYS` /
`PATH_KEYS` sets (lines 13–14), which is correct and prevents a key like `URL ` or `Path.` from
evading detection. Path containment (`normalizePath`, 51–61) is the most security-sensitive control
flow and it is sound: `isOutsideRelativePath` (47–49) rejects `..`, `../…`, and any absolute
`relative` (the last matters on Windows where `path.relative` across drives returns an absolute
path), and on escape it returns the opaque `path:<external>` with `durable:false` (line 60) rather
than embedding the external path. The traversal test at `permission-pattern.test.ts:55–62` pins
`/etc/passwd → ["path:<external>"]`, and the sibling-dots test at `:42–53` confirms a legitimately
in-worktree `..cache` directory is **kept** as durable, so the guard is not over-broad.
`resolveMcpToolPermissionKeys` (33–73) is the most complex control flow: unique identities keep the
legacy base key (45–51), collisions get a 12-hex-char sha256 suffix (line 63), and the suffix-loop
(66–67) guarantees uniqueness even against a pathological hash collision with a reserved key. The
final `resolved.get(...)!` at line 72 is provably safe because every item is added either in the
unique branch or the collision branch (every group has size ≥ 1). `convertMcpTool` (83–124) coerces
the schema to `{type:"object"}` after spreading (87–92) so a malformed server schema cannot claim a
non-object type, truncates descriptions to 4 000 chars (97–100), and rethrows call errors after
logging (119–122) rather than swallowing them — correct fail-loud behavior.

## Step 4 Concurrency, lifecycle, and performance

None of the three files holds long-lived mutable state of its own. `permission-pattern.ts` builds a
fresh `candidates`/`seen` pair per `derive` call (lines 101–102) — no shared mutable state, fully
re-entrant. `templates/index.ts` exports a frozen-in-practice `TEMPLATES` literal; helpers are pure
functions over it. `tool-conversion.ts` is stateless. The only concurrency-relevant detail is in the
consumer: `impl.ts:1060–1085` fires `convertMcpTool` concurrently per tool inside `Promise.all`, and
`convertMcpTool`'s `execute` closure captures `client`/`mcpTool`/`timeout` by value (closure over
`mcpTool` and `client` at lines 105–117) with no shared accumulator — the result is written into a
distinct `result[key]` slot, so there is no data race between conversions. Performance: `derive`'s
generic sweep iterates **all** entries of `args` (line 123, `for (const [key,value] of
Object.entries(args))`) whereas `summarizeArgs` caps at 20 entries (line 73, `.slice(0, 20)`) and the
candidate output is capped at `MAX_PATTERNS=8` (line 147). For an MCP server returning a pathological
args object with thousands of keys this is O(n) work per call in the permission-prompt path. In
practice MCP tool args are small objects, and even at thousands of keys the per-key work is trivial
string normalization, so the impact is bounded — but the asymmetry between the bounded summarizer and
the unbounded sweeper is a genuine (LOW) sharp edge worth a guard `if (output.length >=
MAX_PATTERNS) break` to make the output cap also a work cap.

## Step 5 Design cohesion and trust-boundary ownership

Each file owns exactly one responsibility and the boundaries are clean. `permission-pattern.ts`
owns "translate args → approval patterns + redacted metadata" and deliberately does **not** own the
approval decision itself (that is `ctx.ask` in `prompt-tools.ts:489`). `templates/index.ts` owns
"static catalog + config-shape conversion" and correctly isolates the schema-strictness contract:
the block comment at lines 194–205 documents why `toConfig` emits `environment` (not `env`) and
combines `command`+`args` into a single `string[]`, and the tests at `templates.test.ts:30–31,42,68`
validate every branch against the real `.strict()` zod schemas. `tool-conversion.ts` owns "MCP→AI-SDK
tool bridging and stable permission-key derivation"; the collision-resolution design comment at
`impl.ts:1100–1103` records the invariant that legacy unique keys are preserved so existing
`permission` wildcards like `github_*` keep working — and `permission-contract.test.ts:76–81` pins
exactly that wildcard behavior. The one design note (not a defect): `McpPermissionPattern.derive`'s
result is structural data consumed by a caller in another module, so there is no leak of approval
policy into this unit — the trust boundary (args come from a user-installed MCP server) is clearly
documented at `permission-pattern.ts:13` (the `URL_KEYS`/`PATH_KEYS` sets are the only keys trusted
for durable derivation; everything else falls back to the non-durable wildcard).

## Step 6 Hygiene and error handling

No empty `catch`, no `TODO`/`FIXME`, no `any` in any of the three files (confirmed by reading each in
full; the audit's "empty catches: 0 / TODOs: 0" table matches). Error handling is intentional and
localized. `normalizeUrl` (32–45) wraps `new URL(value)` in try/catch and returns `undefined` on
parse failure, which the caller `addCandidate` treats as "skip this candidate" (line 63–64) — a
non-URL value under a `url` key simply contributes no pattern, the correct degradation.
`mcpSchemaByteLength` (75–81) converts a `JSON.stringify` failure (circular or bigint) into a thrown,
labelled `Error` rather than returning a misleading 0. `convertMcpTool`'s `execute` (105–123) logs
the failing tool name and rethrows so the AI SDK surfaces the failure — no silent suppression.
The only defensive-but-correct swallow is `normalizePath`'s treatment of the no-worktree case (line
53): it returns the raw `cap(value)` with `durable:false`, so even though the literal path enters the
pattern string it can never reach the `always` auto-approve list. I confirmed the production caller
always passes a worktree (`prompt-tools.ts:488` → `Instance.worktree`), so this branch is defensive
only. Logging uses structured fields throughout (`tool`, `error` at `tool-conversion.ts:120`;
`clientName`, `tool`, `error` at `impl.ts:1073–1077`), matching repo convention.

## Step 7 Test evidence and gaps

Coverage is uneven across the three files but the load-bearing contracts are pinned.
`permission-pattern.test.ts` (74 lines) covers: durable url+repo (6–17), URL credential + secret-query
redaction with the exact percent-encoded expectation (19–27), worktree-local path (29–40), the
`..cache` in-worktree edge (42–53), external path → `path:<external>` non-durable (55–62), and the
wildcard fallback with secret-key redaction in metadata (64–73). `permission-contract.test.ts`
(115 lines) gives the **strongest** coverage in the unit: it pins `resolveMcpToolPermissionKeys`
determinism and order-independence (45–62), the sanitize rule (26–42), and — critically — the
user-facing `permission` wildcard semantics against `Permission.fromConfig` (65–99), which is exactly
the invariant the design comment at `impl.ts:1100–1103` relies on. `templates.test.ts` (94 lines)
validates every local template against `Config.McpLocal.parse` and every remote against
`Config.McpRemote.parse` (77–92) — a strong schema-conformance sweep. Gaps I can name with evidence:
(1) `derive`'s `database`/`schema`/`table` branch (`permission-pattern.ts:113–121`) and its
`resource`/`resourceid`/`id` branch (line 141) have **no direct unit test** — the db:schema.table
composition and the `id:` durable pattern are unexercised; (2) `convertMcpTool` itself (the
`dynamicTool` wrapping, the `additionalProperties ?? false` coercion at line 91, the 4 000-char
description truncation, and the >64 KiB throw at 94–96) has **no direct unit test** —
`tool-conversion.test.ts` only covers `mcpSchemaByteLength` (3 cases); the conversion path is
exercised only indirectly via integration tests; (3) the `MAX_PATTERNS=8` truncation at line 147 is
never stressed with a 9-candidate input. All three are LOW (the code paths are simple and the
integration net exists) but they are the places a regression would slip past the current suite.

## Step 8 Backward compatibility and migration

`tool-conversion.ts` encodes a deliberate backward-compatibility contract: legacy tools whose
sanitized `<server>_<tool>` key is unique **keep that exact key** so that existing user
`permission` entries and wildcards continue to match (`resolveMcpToolPermissionKeys` lines 45–51,
documented at `impl.ts:1100–1103` and pinned by `permission-contract.test.ts:53`). Only newly-colliding
names get the `__mcp_<hash>` suffix, and the hash is derived from the full `[server, tool]` identity
(line 63) so it is stable across restarts and across argument order (the order-independence test at
`permission-contract.test.ts:58–61` pins this). `templates/index.ts` exposes `toConfig` (206) whose
output shape (`command: string[]`, `environment`, `url`) is constrained by the `.strict()`
`Config.McpLocal`/`McpRemote` zod schemas; the comment at 194–205 explicitly records that
`McpRemote` has no `environment` field, and `toConfig` honors that by only adding `environment` for
local templates (lines 217 vs 219–221). This means adding a new template field cannot accidentally
break config validation as long as it stays out of `toConfig`'s output. `permission-pattern.ts`'s
`Result` shape (lines 93–98) is consumed by exactly one call site (`prompt-tools.ts:489–497`), so the
pattern vocabulary (`repo:`, `db:`, `url:`, `path:`, `path:<external>`, `*`) is an implicit contract
with the permission system — adding a new durable pattern kind is safe, but renaming an existing one
would silently change what `always` approvals match, so such a change should ship with a
permission-pattern test like the existing ones.

## Step 9 Findings disposition and exit

No Critical-severity finding, no High-severity finding. The `findings/` directory is empty and on
this independent pass I am not elevating anything into it — the unit is defensively written and the
security-tagged surface (permission-pattern derivation) degrades safely to a non-durable wildcard
whenever it cannot prove containment. Dispositions for this pass, all LOW and none requiring a formal
finding file or a code change to ship: **Obs-1 (LOW, perf/robustness)** —
`permission-pattern.ts:123` iterates all args entries while the sibling summarizer at line 73 is
capped at 20 and the output at 8; recommend an early `break` once `candidates.length >= MAX_PATTERNS`
so the output cap is also a work cap. **Obs-2 (LOW, defense-in-depth)** — `permission-pattern.ts:53`
embeds the raw path value into the non-durable pattern when no worktree is supplied; the production
caller always supplies one (`prompt-tools.ts:488`), so this is defensive only, but capping or hashing
the value would make the no-worktree branch leak-proof by construction. **Obs-3 (LOW, test gap)** —
the `database`/`schema`/`table` (113–121) and `resource`/`resourceid`/`id` (141) branches of `derive`
have no direct unit test; add cases asserting `db:foo.bar.baz` composition and `id:xyz` durability.
**Obs-4 (LOW, test gap)** — `convertMcpTool`'s schema coercion, description truncation, and size
throw (93–100) have no direct unit test; the byte-length helper is covered but the wrapper is only
indirectly exercised. **Obs-5 (LOW, supply-chain, design choice)** — `templates/index.ts` launches
servers via `npx -y <pkg>` with no version pin (e.g. lines 52–53, 84–85, 96–97); only
`@playwright/mcp@latest` (114) pins explicitly. This is a deliberate "always current" catalog choice
and not a defect, but noting it so a future hardening pass can optionally pin major versions. No
`reverify.md` is emitted because the Critical-severity precondition is not met. Verification for this
run was a static read of the three candidate sources plus their consumers (`impl.ts`, `prompt-tools.ts`)
and the four test files; this is a review-only unit and I made no code edits.
