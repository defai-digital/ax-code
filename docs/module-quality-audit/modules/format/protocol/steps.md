# Protocol steps — `format`

Unit slug: `format`
Reviewer: ax-code-glm
Model: zai-coding-plan/glm-5.2[1m]
Verifier lane: codex-sol
Date: 2026-08-11

Primary sources read:

- `packages/ax-code/src/format/formatter.ts`
- `packages/ax-code/src/format/index.ts`

Supporting context read (cross-module evidence for the security boundary):

- `packages/ax-code/src/config/config-impl.ts` (`restrictUntrustedConfig`)
- `packages/ax-code/src/config/schema-impl.ts` (`formatter` zod union)
- `packages/ax-code/src/util/which.ts`, `packages/ax-code/src/flag/flag.ts`
- `packages/ax-code/test/format/format.test.ts`

## Step 1 Scope and map

The `format` unit is a two-file module under `packages/ax-code/src/format`. `formatter.ts` (434 lines) is a pure registry of 25 formatter descriptors (`gofmt` at formatter.ts:64 through `dfmt` at formatter.ts:426), each an `Info` record with `name`, `command`, `extensions`, and an async `enabled()` predicate. `index.ts` (202 lines) is the `Format` namespace — it builds the active formatter set from built-ins plus user config, subscribes to `File.Event.Edited`, and runs matching formatters on save. The single public state surface is `Format.init()` (index.ts:185) and `Format.status()` (index.ts:189); everything else is module-private. No XL filtering applies to this unit.

## Step 2 Threat and failure model

The dangerous asset is process execution: every formatter spawns an external binary. Two injection vectors were traced. (a) Config-injected commands: a malicious project `ax-code.json` could set `formatter.foo.command`. This is guarded by `restrictUntrustedConfig` in `config-impl.ts:192-200`, which filters out any formatter override carrying `command` or `environment` for untrusted project config; the zod schema at `schema-impl.ts:677-690` still accepts them, so the trust gate is the only barrier (correct, but worth a regression test). (b) Filename injection: the command array is built with `item.command.map((x) => x.replace("$FILE", file))` at index.ts:125 and passed to `Process.spawn(...)` as an argv array (index.ts:124), so no shell is invoked and a filename containing shell metacharacters cannot break out of its argv slot. No secrets flow through this module (`Env.sanitize()` is applied at index.ts:128). Process trees are killed on timeout via `Process.killProcessTree` (formatter.ts:45, index.ts:144).

## Step 3 Correctness

Traced the live execution path: `Bus.subscribe(File.Event.Edited, ...)` at index.ts:114 → `getFormatter(ext)` (index.ts:96) filters by extension and runs all `enabled()` checks concurrently via `Promise.all` (index.ts:98), then the matching formatters are applied **sequentially** in a `for...of` loop (index.ts:121). Sequential application is intentional and is verified by the test "runs matching formatters sequentially for the same file" (format.test.ts:209), which proves two `.seq` formatters chain into `xAB` rather than racing. One latent correctness defect: `x.replace("$FILE", file)` at index.ts:125 uses `String.prototype.replace` with a string replacement, so a `file` path containing `$` (e.g. `/tmp/$HOME/x`) would be interpreted through `$&`/`$1`/`$` special-replacement patterns and mangle the argv. Low severity because `$` in paths is rare and the result is a failed formatter run, not code execution. Also note `enabled()` for config overrides is hard-coded to `async () => true` at index.ts:80, so an override naming an uninstalled tool will still attempt to run and log a failure — acceptable, but means config overrides bypass the `which()` install check.

## Step 4 Performance

`enabled()` results are memoized per instance in the `enabled` map (index.ts:87-94), so the repeated `which()` / `Filesystem.findUp()` probes are only paid once per formatter per session, not once per saved file. The `which()` utility itself caches successful lookups for 5 minutes (`which.ts:19-20`). Two help-command probes (`runHelpCommand` at formatter.ts:32, used by `rlang` at :259 and `uvformat` at :281) run a 5 s bounded subprocess (`HELP_CHECK_TIMEOUT_MS` at formatter.ts:10); these run inside the memoized `enabled()` so they fire at most once. `uvformat.enabled()` calls `ruff.enabled()` (formatter.ts:279) to enforce ruff precedence — also memoized, so no duplicate work. Format runs themselves are bounded by a 30 s timeout (`FORMATTER_TIMEOUT` at index.ts:133) and ignore stdio (index.ts:129-130). No N+1 or unbounded work found.

## Step 5 Design

The registry-of-descriptors pattern in `formatter.ts` is a good fit: each tool is a self-contained data record, `index.ts` is policy. Ownership is clean. One design smell is the override merge at index.ts:68-73: `mergeDeep` from remeda replaces arrays wholesale, so an extensions-only override would clobber the built-in `command` to `[]` and get silently dropped by the `info.command.length === 0` guard (index.ts:75). The code now seeds `command`/`extensions` from the built-in before merging (index.ts:68-70) and is covered by the regression test at format.test.ts:75, but the workaround is fragile — a future field added to `Info` would need the same seeding. A shallow per-field merge keyed off the `Info` schema would be more robust. The `normalizeCommand` guard (index.ts:33-38) correctly rejects all-whitespace commands.

## Step 6 Hygiene and dead code

No empty catches and no TODOs (confirmed against the MODULE-AUDIT inventory). Real duplication exists: the 28-entry extension list is byte-identical between `prettier` (formatter.ts:86-113) and `biome` (formatter.ts:152-179); extracting a shared `WEB_EXTENSIONS` constant would remove ~27 duplicated lines. The package.json dependency-detection block is near-identical between `prettier.enabled()` (formatter.ts:114-125) and `oxfmt.enabled()` (formatter.ts:133-145), and the composer.json variant in `pint.enabled()` (formatter.ts:394-405) is structurally the same — a `detectManifestDep(manifestFile, depField, depName)` helper would dedupe three call sites (meets the 3+ threshold for extraction). The config-file `findUp` + `length > 0` idiom recurs in `clang`, `ocamlformat`, `biome` but each differs enough that extraction is marginal. `runHelpCommand` (formatter.ts:32) is a legitimate shared helper used by exactly two callers — not dead.

## Step 7 Tests

`packages/ax-code/test/format/format.test.ts` (290 lines, 9 cases) covers the meaningful behavior contracts: built-in presence (format.test.ts:20), global disable via `formatter: false` (:43), per-name disable (:56), extensions-only override preserving command (:75 — the regression for the mergeDeep bug), blank-command override rejection (:99), and the parallel-`enabled` / sequential-run semantics (:150, :209). The kill-wait race on help-command timeout is explicitly tested at :244-289, proving `runHelpCommand` awaits `timeoutKill` before returning. Coverage gap: there is no test asserting that `restrictUntrustedConfig` strips `command` from project formatter config — the security gate in step 2 is enforced only by code review, not by a regression test. A negative test feeding an untrusted config with a `formatter.x.command` field and asserting it is absent from `Format.status()` would close the gap.

## Step 8 Finding register

Findings ledger for this pass (no Critical; `findings/` directory is empty):

- LOW — `$FILE` substitution uses `String.replace` special-pattern semantics (index.ts:125). Suggested fix: pass a replacer function `() => file` or `replaceAll` with a pre-escaped value. No external finding file written (below the bar for a tracked finding).
- LOW — Duplicate 28-entry web extension list across `prettier` (formatter.ts:86-113) and `biome` (formatter.ts:152-179). Extract `WEB_EXTENSIONS`.
- LOW — Triplicated manifest-dependency detection (`prettier`, `oxfmt`, `pint`). Extract a shared helper.
- INFO — Config override forces `enabled = async () => true` (index.ts:80), bypassing the `which()` install check; documented behavior.
- INFO — Format run ignores stdout/stderr (index.ts:129-130), so formatter failure detail is lost; only `log.error("failed", {command})` remains.

No Critical or High severity items. The command-injection boundary is sound (config gate + argv spawn). reverify.md is therefore not required for this unit.

## Step 9 Verification and exit

This pass is a read-only architectural review by the ax-code-glm lane; no source files were modified, so no `verify_project` / typecheck / test run is cited for a code change. The behavioral contracts referenced above were validated by re-reading `packages/ax-code/test/format/format.test.ts` and confirming each assertion maps to the implementation lines cited (sequential run → index.ts:121; mergeDeep regression → index.ts:68-75; kill-wait → formatter.ts:56-59). Exit checklist: 9 steps complete, evidence is file:line anchored, no Critical findings, no reverify.md needed. Independent verifier lane codex-sol may confirm or contest the LOW/INFO dispositions.
