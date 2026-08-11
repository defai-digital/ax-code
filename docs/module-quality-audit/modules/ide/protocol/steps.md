# Protocol — 9-step review for unit `ide`

Reviewer: ax-code-glm (model `zai-coding-plan/glm-5.2[1m]`)
Verifier lane: codex-sol
Unit slug: `ide`
Resolved root: `packages/ax-code/src/ide`
Primary source read: `packages/ax-code/src/ide/index.ts` (74 LOC, 7 exported symbols inside the `Ide` namespace).

## Step 1 Scope and map

The unit is a single TypeScript module: `packages/ax-code/src/ide/index.ts`. It exposes one namespace `Ide` (line 16) containing the event registry entry `Event.Installed` (lines 19–26), two error classes `AlreadyInstalledError` (line 28) and `InstallFailedError` (lines 30–35), and three functions: `ide()` (line 37), `alreadyInstalled()` (line 47), and `install()` (line 51). A private `SUPPORTED_IDES` array (lines 8–14) maps product names such as `"Visual Studio Code - Insiders"` to launcher commands such as `code-insiders`. Direct dependencies observed via imports at lines 1–6 are `BusEvent`, `zod`, `NamedError`, `Log`, `Process`, and `Flag` — all first-party except `zod`.

## Step 2 Inventory and consumers

A repository-wide grep for `import … Ide … from` returns exactly one match outside the unit itself: `packages/ax-code/test/ide/ide.test.ts:2` (`import { Ide } from "../../src/ide"`). No file under `packages/ax-code/src/`, `desktop/packages/`, or any other `packages/*` imports the `Ide` namespace or reaches it through `@/ide` / relative paths. The desktop shell maintains its own IDE launcher tables at `desktop/packages/electron/src/main.js:1184` (`vscodium`, `windsurf`, etc.) and `desktop/packages/ui/src/lib/openInApps.ts:14`, neither of which calls into this module. Result: at runtime, the entire `Ide` namespace is reachable only from its own test — there is no production call site for `Ide.ide()`, `Ide.alreadyInstalled()`, or `Ide.install()`.

## Step 3 Correctness

`Ide.ide()` at lines 37–45 reads `process.env["TERM_PROGRAM"]` and, only when it equals `"vscode"`, scans `GIT_ASKPASS` for a substring match against each `SUPPORTED_IDES[i].name`. The ordering in `SUPPORTED_IDES` matters because `"Visual Studio Code"` is a substring of `"Visual Studio Code - Insiders"`; the array lists Insiders (line 10) before stable (line 11), so the more specific name wins. The unit test at `packages/ax-code/test/ide/ide.test.ts:21–27` asserts this and passes. Two real robustness gaps remain: (a) `v?.includes(ide.name)` (line 41) matches arbitrary substrings, so a user whose home or app path contains `Cursor` or `Windsurf` as a path component could be mis-detected; (b) the function silently returns `"unknown"` (line 44) for any non-vscode terminal, even if `GIT_ASKPASS` clearly points at a known editor — callers get no signal versus a truly unknown environment.

## Step 4 Threat and failure model

The only subprocess execution is `install()` at lines 55–57: `Process.run([cmd, "--install-extension", "sst-dev.ax-code"], { nothrow: true })`. `cmd` is constrained to the five literals in `SUPPORTED_IDES` (no shell, array form), so there is no command-injection surface from user input; the `ide` argument is validated against `SUPPORTED_IDES.find(...)` at line 52 and an unknown name throws synchronously at line 53. The `--install-extension` invocation shells out to the user's `code`/`cursor`/`windsurf`/`codium` binary on PATH; if an attacker plants a hostile `code` early on PATH they get code execution, but that is the standard trust model for any PATH lookup and is not specific to this module. No file-system writes outside the extension manager, no network I/O, no secrets read or logged. The `log.info("installed", { stdout, stderr })` at lines 61–65 records full CLI output, which is benign here because the CLI output is not secret.

## Step 5 Performance

All three exported functions are trivial: `ide()` does up to five string `includes` checks (lines 40–42), `alreadyInstalled()` is two env-string comparisons (line 48), and `install()` is one short-lived child process per call (lines 55–57). There is no hot path, no allocation pressure, no I/O loop. The only note is that `install()` is `async` but `alreadyInstalled()` and `ide()` are synchronous despite living in a namespace where a caller might expect uniform async behavior; this is not a defect given the work they do.

## Step 6 Design and coupling

The module has tight, well-bounded coupling: it depends on six first-party modules (`BusEvent`, `NamedError`, `Log`, `Process`, `Flag`, `zod`) and exposes a single namespace with a coherent responsibility (detect and install into the host editor). The `Ide.Event.Installed` registration (lines 19–26) is correctly typed via `BusEvent.define`, which feeds the OpenAPI event union in `packages/ax-code/src/bus/bus-event.ts:9–16`. However, the design implies an emit side that does not exist: nothing in the unit, and nothing elsewhere in the repo, ever publishes `ide.installed`. The natural place — the success tail of `install()` (after line 72) — has no emit call. Combined with the zero-caller result from Step 2, this means the event type is reserved in the public API contract but is functionally dead.

## Step 7 Dead code and hygiene

This is the dominant finding for the unit. (a) `Ide.install` is not reachable from any production code path; the function, its `cmd` lookup (line 52), the `nothrow` runner (lines 55–57), the success/failure branching (lines 67–72), and the two named errors `InstallFailedError` (lines 30–35, thrown line 68) and `AlreadyInstalledError` (line 28, thrown line 71) all exist solely to be exercised by tests, and the test file does not exercise `install()` at all — `packages/ax-code/test/ide/ide.test.ts` only covers `Ide.ide()` (lines 14–63) and `Ide.alreadyInstalled()` (lines 65–81). (b) `Ide.Event.Installed` (lines 19–26) has no producer anywhere in the codebase. (c) The literal `"sst-dev.ax-code"` at line 55 is a hardcoded extension identifier; acceptable while the module is dormant, but it would belong in a constants file if the install path were ever wired up. (d) There are zero empty catches, zero TODOs, no commented-out blocks — the file is otherwise clean.

## Step 8 Tests

`packages/ax-code/test/ide/ide.test.ts` (82 LOC, 11 cases) is the only coverage. It is well-written for what it covers: it snapshots `process.env` in `afterEach` (lines 7–12) and asserts each branch of `Ide.ide()` — VS Code (lines 14–19), Insiders (21–27), Cursor (29–34), VSCodium (36–41), Windsurf (43–48), the `TERM_PROGRAM !== "vscode"` fall-through (50–56), and the unmatched-`GIT_ASKPASS` fall-through (58–63) — plus the three branches of `Ide.alreadyInstalled()` (65–81). Coverage gaps are real: `Ide.install()` has no test (no mock of `Process.run`, no assertion on the `code !== 0` / `stdout.includes("already installed")` branches at lines 67–72), and neither `InstallFailedError` nor `AlreadyInstalledError` is ever constructed or asserted in any test file. If the module is revived, an injection seam for `Process.run` is required first.

## Step 9 Verification and sign-off

Static extract matches the audit fingerprint `4efe9427464f15e1` (1 file, 75 LOC reported vs 74 measured here — within rounding). No Critical-severity findings; the issues above are MEDIUM (orphaned install path and unused event) and LOW (substring-match fragility, missing Windows cmd variants in `install()` relative to `desktop/.../main.js:1184`, no test for `install()`). Recommended primary-reviewer disposition: either (a) wire `Ide.install` into a real caller (e.g. an `ax-code ide install` CLI subcommand) and add the missing event emit + tests, or (b) delete `install`, `InstallFailedError`, `AlreadyInstalledError`, and `Event.Installed` and shrink the unit to just detection (`ide()` + `alreadyInstalled()`), which is the only path used in the wild. Decision deferred to module owner. No reverify.md is required because no Critical findings were accepted.
