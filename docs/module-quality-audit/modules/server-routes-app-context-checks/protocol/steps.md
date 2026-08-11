# Protocol Steps — server-routes-app-context-checks

- Reviewer: `ax-code-glm`
- Verifier lane: `codex-sol`
- Model: `zai-coding-plan/glm-5.2[1m]`
- Date: `2026-08-11`
- Scope file: `packages/ax-code/src/server/routes/app-context-checks.ts`

## Step 1 Scope and map

Unit `server-routes-app-context-checks` resolves to a single file: `packages/ax-code/src/server/routes/app-context-checks.ts` (227 lines, one export `contextChecks` at line 131). The export is consumed exactly once — by `packages/ax-code/src/server/routes/app-context.ts:72`, which feeds the resulting array into the `checks` field of the `app.context` GET response (schema `AppContextCheck` in `app-context-schema.ts:27-33`). No other callers exist in `src/`. The module is pure: no network, no DB, no mutation — it only reads files and returns an array of shell-command strings. Output type matches the zod enum for `source` (`"root" | "directory"`).

## Step 2 Threat and failure model

`contextChecks` only reads local project files (`package.json`, lockfiles, `Makefile`, `deno.json[c]`, `Cargo.toml`, `go.mod`) and never executes anything — produced commands are returned to the caller as data, not run here. Inputs `{ root, dir }` come from `Instance` server-side (`app-context.ts:72`), not from request bodies or query params, so there is no path-injection vector through this unit. No credentials are read, logged, or serialized. The realistic failure mode is I/O and parse failure during the directory walk: `readOptionalJson` (line 117) rethrows anything that is not ENOENT, and `Filesystem.readJson` (`util/filesystem.ts:48-58`) throws `Failed to parse JSON in <file>` on malformed content.

## Step 3 Correctness

`addCheck` (line 81) caps output at four entries via `out.length >= 4` and shares one `seen` set across all ecosystems (npm / Make / deno / cargo / go), so dedup is global — correct and intentional. Two correctness smells:

- `makeTargets` (line 101) matches `^([A-Za-z0-9_.-]+)\s*:`. In a real Makefile the line `GOOS := linux` also matches, so a `:=` (or `?=`, `::=`) variable assignment whose name collides with `verify|check|test|lint|build|typecheck` would be misreported as a target. Probability is low for the literal names in `makeOrder` (line 155), but the parser is not target-aware — it should reject `:` immediately followed by `=`.
- `readOptionalJson` (line 117-122) is "optional" only with respect to ENOENT. A corrupt `package.json` anywhere between `dir` and `root` throws and bubbles out of `contextChecks` into the `app-context.ts` handler, which has no try/catch around the call — the whole `GET /context` would 500 for a JSON syntax error in a package.json the caller may not even be running checks against. See Step 8.

The early-return precedence (root `package.json` first, then nearest, then Makefile, deno, cargo, go) matches the documented ordering intent and is consistent across the `uniqueFiles([root/..., ...findUp(dir→root)])` constructions on lines 156, 172, 196, 211.

## Step 4 Performance

`contextChecks` runs on every `GET /context` — there is no caching layer in `app-context.ts`. Each invocation performs: 1 `findUp("package.json")` walk, 1 `Filesystem.up` lockfile walk per discovered package dir, and 1 `findUp` each for `Makefile`, `deno.json`, `deno.jsonc`, `Cargo.toml`, `go.mod`. Each walk does serial `fs.access` calls (`util/filesystem.ts:225-237`, `239-252`). In a deep monorepo this is dozens of syscalls per request. All probes are bounded by `stop: root` so they cannot escape the workspace, but they are sequential `await` — the independent ecosystem blocks (Makefile / deno / cargo / go) could be `Promise.all`-ed to cut request latency. No N+1 and no unbounded growth.

## Step 5 Design

The shape is clean: pure helpers (`quote`, `relativeFromRoot`, `checkLabel`, `checkCommand`, `checkTitle`, `inDir`, `makeTargets`, `uniqueFiles`, `readOptionalJson`, `readOptionalText`) above a single orchestrator (`contextChecks`). The four ecosystem blocks (lines 160-224) are repetitive, but each emits a different command shape; collapsing them into a data-driven table would trade local clarity for indirection without shrinking the public surface, so I would not refactor it. Two minor design nits: (a) the cap `out.length >= 4` on line 98 is an unnamed literal — promote to `const MAX_CHECKS = 4` with a one-line rationale; (b) `relativeFromRoot` (line 11) is a one-line wrapper around `path.relative` and could simply be inlined at the three call sites.

## Step 6 Hygiene

No empty catches in this file. `readOptionalJson` / `readOptionalText` (lines 117-129) correctly narrow errors via `Filesystem.isEnoent` (`util/filesystem.ts:69`) and rethrow everything else — this is the intended pattern. One redundancy: for `makeFiles`, `denoFiles`, `cargoFiles`, `goFiles` the orchestrator re-checks `Filesystem.exists` (lines 161, 179, 201, 215) on results that already came from `findUp`, which only yields existing paths (`util/filesystem.ts:230`). The re-check is genuinely needed only for the `path.join(input.root, …)` candidate prepended at the start of each `uniqueFiles([...])` call, so it is correct but slightly wasteful for the findUp portion. No TODOs, no commented-out code, no dead branches.

## Step 7 Tests

No test file targets this module directly. The matches listed in `MODULE-AUDIT.md §1 Tests` are incidental route-level tests (e.g. `test/control-plane/workspace-server-sse.test.ts`) and unrelated context tests (`test/context/*`). There is no regression coverage for: the 4-entry cap, the ecosystem precedence ordering, the `makeTargets` regex, the cross-ecosystem `seen` dedup, or the `quote` whitespace rule. A focused unit test that points `contextChecks` at a fixture tree containing a root `package.json` plus a nested `Makefile` and `Cargo.toml` would lock in both the ordering and the cap, and would have caught the `:=` parsing drift described in Step 3.

## Step 8 Finding register

Findings discovered during this pass (for the verifier lane `codex-sol` to accept or rebut and file under `findings/`):

- **M — `readOptionalJson` lets a malformed `package.json` 500 the whole `GET /context`** — `app-context-checks.ts:117-122` combined with the unguarded call site at `app-context.ts:72`. Suggested fix: either swallow parse errors into `null` inside `readOptionalJson` (treat "optional" as "best-effort"), or wrap the `contextChecks` call in `app-context.ts` so a check-list failure never fails the surrounding context payload.
- **L — `makeTargets` misclassifies `:=` / `?=` / `::=` Makefile assignments as targets** — `app-context-checks.ts:101-111`. Suggested fix: require `:` not followed by `=`.
- **L — Magic cap literal `4`** — `app-context-checks.ts:98`. Suggested fix: extract `const MAX_CHECKS = 4` with a comment.
- **L — No direct unit test** — see Step 7.

No High or Critical findings. The verifier lane should independently re-read `readOptionalJson` and `app-context.ts:72` before promoting the M item.

## Step 9 Verification and exit

Evidence for this pass: I read the unit file end-to-end, its only consumer (`packages/ax-code/src/server/routes/app-context.ts`), the response schema (`packages/ax-code/src/server/routes/app-context-schema.ts`), and the `Filesystem` helpers (`packages/ax-code/src/util/filesystem.ts`) plus `packages/ax-code/src/util/string-list.ts` to validate behavior claims about `findUp`, `up`, `readJson`, `isEnoent`, and `uniqueStrings`. Static-extract fingerprint `c70527832eae04a3` matches `MODULE-AUDIT.md`. This is the read-only reviewer lane — no code edits were made. Findings ledger is Step 8; because no Critical items were identified, `reverify.md` is not emitted by this lane. Hand-off to verifier `codex-sol` for an independent second pass on the M finding.
