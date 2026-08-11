# Protocol Steps — cli-cmd-skill

Reviewer: ax-code-glm (model: zai-coding-plan/glm-5.2[1m])
Unit slug: `cli-cmd-skill`
Primary source: `packages/ax-code/src/cli/cmd/skill.ts` (224 lines)
Verifier lane: codex-sol

## Step 1 Scope and inventory

`cli-cmd-skill` resolves to a single TypeScript module at `packages/ax-code/src/cli/cmd/skill.ts` (224 lines). It defines the yargs `skill` command tree with five subcommands — `list` (line 83), `create` (line 103), `validate` (line 143), `doctor` (line 164), and `test-trigger` (line 185) — plus six pure formatting/exit-code helpers exported for reuse (`applySkillValidationExitCode` line 31, `formatSkillList` line 38, `formatSkillValidationReport` line 50, `formatSkillDoctorReport` line 65, `formatSkillTriggerReport` line 75) and the aggregate `SkillCommand` at line 212. The command is wired into the CLI at `packages/ax-code/src/cli/boot.ts:41,102`. The module also re-exports five authoring helpers and three report types from `packages/ax-code/src/skill/authoring.ts` (skill.ts:22-29) so callers can import them via the CLI path — the test suite relies on this barrel at `packages/ax-code/test/cli/skill.test.ts:3-14`.

## Step 2 Threat and failure model

The module's only write-to-filesystem path is `SkillCreateCommand` (skill.ts:122-140). User-controlled `args.name`, `args.description`, and `args.path` flow into `createSkill` (authoring.ts:192-200), which validates the name against `/^[a-z0-9]+(-[a-z0-9]+)*$/` (authoring.ts:58,65) — this regex blocks path-traversal payloads like `../../etc` because `.` is rejected. The resolved path is additionally gated by `assertContained` (authoring.ts:113-119) confining writes to the worktree or home directory, and a `SkillExistsError` is thrown if the target SKILL.md already exists (authoring.ts:197). The CLI handler catches `SkillExistsError`, `SkillPathError`, and `SkillInputError` (skill.ts:132) and sets `process.exitCode = 1` without leaking stack traces. Read-only commands (`list`, `validate`, `doctor`, `test-trigger`) only invoke `Skill.all()` and the report builders, so they cannot mutate user state. No `process.env` secrets are read or echoed; the only stdin/stdout surface is the formatted report or JSON dump.

## Step 3 Correctness

`applySkillValidationExitCode` (skill.ts:31-36) only escalates: it sets `target.exitCode = 1` when `report.invalid > 0` but never resets to 0 on a clean run. This is intentional — it composes correctly with other failure signals — and the test at `test/cli/skill.test.ts:99-105` confirms a clean report leaves the exit code untouched. `formatSkillList` (skill.ts:38-48) computes `status` from `skill.standardIssues?.length ? "warn" : "ok"`, matching the validation report semantics in `buildSkillValidationReport` (authoring.ts:121-136). `SkillTestTriggerCommand` correctly omits `applySkillValidationExitCode` because trigger-matching is orthogonal to standard compliance. One subtle correctness note: `SkillCommand`'s own `async handler() {}` at skill.ts:223 is dead by construction because `.demandCommand()` at line 222 forces a subcommand — yargs requires the `handler` key but it never runs.

## Step 4 Performance

Each subcommand handler calls `bootstrap(process.cwd(), …)` (skill.ts:92,123,152,173,200) which sets up the `Instance` context and disposes it in a `finally` (bootstrap.ts:9-14). Inside, every handler invokes `Skill.all()`, which resolves the cached `Instance.state` (skill/index.ts:247,398-401) — so the filesystem-heavy discovery (scanning built-in, `.claude`/`.agents`/`.opencode`, and config dirs) runs at most once per process. The format helpers are O(n) over skills and their issues, with no nested scans; `formatSkillDoctorReport` (skill.ts:65-73) sorts source keys with `localeCompare`, which is negligible for typical skill counts (<100). No N+1 patterns. JSON output uses `JSON.stringify(report, null, 2)` with 2-space indent — acceptable for CLI diagnostics; not a hot path.

## Step 5 Design

The module cleanly separates presentation (formatters + yargs wiring) from domain logic (authoring.ts reports and `createSkill`). The `cmd` helper (cmd.ts:5-7) is a thin passthrough that adds the `--` passthrough type. One minor design smell: the CLI module re-exports five authoring helpers and three types (skill.ts:22-29) purely so the test file can import them from `"../../src/cli/cmd/skill"`. This makes the CLI module a partial barrel for `../../skill/authoring`, blurring the boundary between the command layer and the domain layer. A cleaner design would have the tests import directly from `../../src/skill/authoring` and drop the re-exports, leaving `skill.ts` focused solely on yargs command definitions. This is a LOW-severity observation, not a blocking issue.

## Step 6 Dead code and duplication

The empty `async handler() {}` at skill.ts:223 is required by the `CommandModule` shape but unreachable because of `.demandCommand()` at line 222 — it is structurally dead but unavoidable without abandoning the `cmd()` wrapper. No duplicated logic was found inside this module. The `applySkillValidationExitCode` helper is reused by both `validate` (line 159) and `doctor` (line 180), avoiding copy-paste of the exit-code rule. The `String(args.name)` / `String(args.description)` coercions at skill.ts:126-127 are defensive against yargs' loose `any` typing rather than dead code; the `args.files as string[] | undefined` cast at line 201 serves the same purpose and is followed by `.filter(Boolean)` to discard empty positional strings.

## Step 7 Tests

The unit suite at `packages/ax-code/test/cli/skill.test.ts` (189 lines) covers the pure helpers well: `formatSkillList` warning/ok marking (line 56), `formatSkillValidationReport` formatting (line 71), `applySkillValidationExitCode` both branches (lines 91,99), `buildSkillValidationReport` / `buildSkillDoctorReport` / `buildSkillTriggerReport` summary logic (lines 32,107,120,143,155), the `skillCreatePath`/`skillCreateContent` skeleton (line 165), and the `createSkill` name-validation guard including a `../../escape` traversal attempt (line 179-188). Coverage gap: none of the five yargs command modules (`SkillListCommand`, `SkillCreateCommand`, `SkillValidateCommand`, `SkillDoctorCommand`, `SkillTestTriggerCommand`) nor the aggregate `SkillCommand` are exercised end-to-end — the `--json` output branches (skill.ts:94-96,154-155,175-176,203-204), the `path.resolve` branch in `create` (line 128), and the `args.files` cast + `.filter(Boolean)` in `test-trigger` (line 201) have no direct tests. Adding a small harness that invokes the yargs builder/handler with a stubbed `bootstrap` would close this gap.

## Step 8 Findings register

No findings were accepted for `cli-cmd-skill`. The `findings/` directory is empty and the MODULE-AUDIT.md register (line 68) records `_none accepted_`. Two LOW-severity observations are noted above (the CLI-as-barrel re-exports in Step 5, and the untested yargs handler wiring in Step 7) but neither rises to an actionable finding requiring a patch — the re-exports are load-bearing for the existing test imports, and the helper-level coverage already protects the domain logic. No Critical or High items exist, so no `reverify.md` is required from this primary pass.

## Step 9 Verification and exit

This pass read `packages/ax-code/src/cli/cmd/skill.ts` in full, cross-referenced `packages/ax-code/src/skill/authoring.ts` (220 lines), `packages/ax-code/src/cli/cmd/cmd.ts`, `packages/ax-code/src/cli/bootstrap.ts`, the relevant regions of `packages/ax-code/src/skill/index.ts` (the `Skill.all` definition at line 398, `matchByPaths` at line 376, and the discovery containment logic at lines 300-313), and the test file `packages/ax-code/test/cli/skill.test.ts`. Static inspection confirms the module is internally consistent, the security boundary for `create` is enforced downstream in `assertContained`, and the exit-code semantics are covered by unit tests. Recommended verification commands for a follow-up implementer: `pnpm --dir packages/ax-code run test:unit` (covers `test/cli/skill.test.ts`) and `pnpm --dir packages/ax-code run typecheck`. Sign-off: reviewer ax-code-glm complete; independent verifier codex-sol pending.
