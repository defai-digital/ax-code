# Implementation Plan: Agent Workflow and Skill Productization

**Date:** 2026-06-07
**Status:** Implemented - first productization slice complete
**Scope:** Internal implementation plan
**Related:** ADR-029, `.internal/prd/PRD-2026-06-07-agent-workflow-skill-productization.md`,
`.internal/prd/TECH-SPEC-2026-06-07-agent-workflow-skill-productization.md`, ADR-024, ADR-025, ADR-027, ADR-028

---

## Objective

Turn AX Code's existing skills, commands, agents, and workflow templates into a coherent reusable capability layer.

The plan prioritizes low-risk productization before deeper automation:

1. make discovery compatible with `.agents`, `.claude`, and `.opencode`;
2. add file-backed prompt commands;
3. expose a unified catalog for TUI, CLI, SDK/server, and desktop surfaces;
4. modernize agent creation around `permission`;
5. add skill authoring and diagnostics;
6. add workflow-backed command entry points behind the existing Workflow Runtime flag;
7. add compatibility importers;
8. prepare replay/evidence data for later skill/workflow evaluation.

## Operating Rules

- Keep each phase independently reviewable and testable.
- Do not run tests from the repository root.
- Use Zod for new parsing and validation.
- Use `async/await`, existing error-boundary patterns, and small domain helpers; do not add new Effect usage.
- Keep CLI commands thin; domain behavior belongs under `src/skill`, `src/command`, `src/agent`, `src/workflow`, or a
  new `src/capability` domain.
- Preserve all existing config command, skill, agent, and workflow behavior unless the phase explicitly changes it.
- Do not implement shell-output interpolation for file-backed commands in the first slice.
- Do not enable Workflow Runtime by default.
- Do not add project-local lifecycle hooks under this plan.
- Do not auto-delete or auto-rewrite user files during import or doctor flows.
- Keep `.internal/` planning files internal; do not create public docs from this plan until implementation proves stable.

## Dependency Order

Implementation order matters:

1. source metadata and compatibility discovery;
2. file-backed command parsing;
3. catalog aggregation;
4. authoring/doctor commands;
5. UI/server exposure;
6. workflow bridge;
7. importers;
8. evaluation telemetry.

The catalog should not be built first from speculative types. Build it after the first concrete discovery sources exist,
then make it the shared UI/server adapter.

## Implementation Result

Implemented on 2026-06-07:

- `.opencode/skills` discovery with source and scope metadata.
- File-backed commands for `.agents`, `.opencode`, `.claude`, and existing `.ax-code/commands` paths.
- Shell-output interpolation warnings for file-backed commands, with runtime shell expansion disabled for those commands.
- Unified capability catalog through `src/capability`, `ax-code capability list`, `GET /capability`, and SDK generated
  types/client access.
- TUI slash autocomplete source labels for MCP, file-backed, skill-backed, and workflow-backed commands.
- `ax-code agent create` output modernization from deprecated `tools` to `permission`.
- `ax-code skill create`, `skill doctor`, and `skill test-trigger`.
- Workflow-backed command frontmatter behind `AX_CODE_WORKFLOW_RUNTIME`, creating and starting trusted workflow runs.
- Dry-run-by-default compatibility importers for `opencode`, `claude`, and `codex`.
- Command execution telemetry for source, warnings, workflow template, and workflow run linkage.

Deferred follow-up:

- Full desktop command-center UI tabs remain a product follow-up; this slice exposes the typed catalog and TUI slash
  labels.
- Skill recommendation/load replay telemetry remains a follow-up; this slice records command and workflow linkage.
- Workflow command artifact surfacing remains owned by existing workflow run/detail routes; this slice starts the run and
  reports the run id through the parent prompt path.

## Phase 0: Planning Baseline

**Status:** Complete.

Goal: capture the decision, requirements, and implementation shape.

Completed work:

- Added PRD for Agent Workflow and Skill Productization.
- Added tech spec for the capability layer.
- Added ADR-029.
- Updated PRD and ADR indexes.

Exit gates:

- The PRD, tech spec, and ADR are present and linked from indexes.
- No source code behavior changes are included in the planning slice.

Validation:

```sh
rg -n '[[:blank:]]$' .internal/prd/PRD-2026-06-07-agent-workflow-skill-productization.md \
  .internal/prd/TECH-SPEC-2026-06-07-agent-workflow-skill-productization.md \
  .internal/adr/ADR-029-agent-workflow-skill-productization-boundary.md
```

## Phase 1: Skill Discovery Compatibility

**Status:** Complete.

Goal: read OpenCode-style skills without changing the skill execution model.

Tasks:

1. Replace the current external skill directory list with source-aware discovery:
   - `.agents`
   - `.claude`
   - `.opencode`
2. Keep scanning `skills/**/SKILL.md` under each external root.
3. Add optional source metadata to either `Skill.Info` or the capability aggregation layer:
   - `sourceTool: "agents" | "claude" | "opencode" | "ax-code" | "builtin"`
   - `scope: "builtin" | "project" | "user" | "config" | "compat"`
4. Preserve existing duplicate-name runtime behavior for now, but expose duplicates through diagnostics in later phases.
5. Add fixture skills for `.opencode/skills`.
6. Add tests for:
   - user-level `.opencode/skills`;
   - project-level `.opencode/skills`;
   - parent-directory discovery from CWD upward;
   - path recommendations still work with `.opencode` skills;
   - `AX_CODE_DISABLE_EXTERNAL_SKILLS` disables all external compatibility roots.

Files likely touched:

- `packages/ax-code/src/skill/index.ts`
- `packages/ax-code/test/skill/skill.test.ts`
- `packages/ax-code/test/session/system.test.ts`

Exit gates:

- `.opencode/skills/<name>/SKILL.md` is discovered exactly like `.agents/skills`.
- Existing `.claude` and `.agents` behavior does not regress.
- Built-in skills and configured `skills.paths` still work.

Validation:

```sh
cd packages/ax-code
bun test test/skill/skill.test.ts test/session/system.test.ts
bun run typecheck
```

## Phase 2: File-Backed Command Discovery

**Status:** Complete.

Goal: let users define prompt commands in files, starting with prompt-only markdown.

Tasks:

1. Add a command discovery helper under `src/command/`.
2. Scan project/user command roots:
   - `.agents/commands/*.md`
   - `.ax-code/commands/*.md`
   - `.opencode/commands/*.md`
   - `.claude/commands/*.md` only if accepted after parser tests prove safe, otherwise import-only.
3. Parse markdown frontmatter with existing markdown/config parsing utilities where possible.
4. Support frontmatter fields:
   - `description`
   - `agent`
   - `model`
   - `subtask`
5. Add a parsed warning model for:
   - unknown fields;
   - unsupported `workflow` before Phase 7;
   - unsupported OpenCode `!` shell-output interpolation;
   - invalid model string;
   - empty template body.
6. Integrate file commands into `Command.layer` after built-ins/config commands and before MCP/skill fallback commands.
7. Keep built-in commands protected from file-command override in this phase.
8. Add command list output tests for source and warnings if command list exists; otherwise add helper tests only.

Files likely touched:

- `packages/ax-code/src/command/index.ts`
- `packages/ax-code/src/command/discovery.ts` or equivalent new helper
- `packages/ax-code/test/command/*.test.ts`
- `packages/ax-code/test/session/prompt-helpers.test.ts`

Exit gates:

- A command file can be invoked through the existing command path.
- `$ARGUMENTS` and positional hints still work through existing substitution behavior.
- Unsupported shell interpolation is reported, not executed.
- Built-ins remain protected.

Validation:

```sh
cd packages/ax-code
bun test test/command test/session/prompt-helpers.test.ts
bun run typecheck
```

## Phase 3: Unified Capability Catalog

**Status:** Complete.

Goal: expose reusable behavior as one catalog without merging the runtime ownership of each primitive.

Tasks:

1. Add a `src/capability/` domain helper or equivalent aggregation module.
2. Define `CapabilityInfo` with:
   - `kind`
   - `name`
   - `description`
   - `scope`
   - `source`
   - `sourceTool`
   - type-specific metadata for command, skill, agent, and workflow entries;
   - warning list.
3. Aggregate:
   - built-in/config/file/MCP/skill commands;
   - skills from `Skill.all()`;
   - agents from `Agent.list()`;
   - workflow templates from `WorkflowTemplate.list()` when runtime or route policy allows listing.
4. Add duplicate-name diagnostics across commands and skills.
5. Add source inference for existing skill locations if `Skill.Info` is not widened in Phase 1.
6. Add a CLI surface:
   - preferred: `ax-code capability list --json`;
   - acceptable fallback: add richer `--json` to existing `skill`, `agent`, and future `command` list commands.
7. Add tests for stable sorting and deterministic JSON output.

Files likely touched:

- `packages/ax-code/src/capability/index.ts`
- `packages/ax-code/src/cli/cmd/*`
- `packages/ax-code/test/capability/*.test.ts`
- `packages/ax-code/test/cli/*.test.ts`

Exit gates:

- Catalog output distinguishes skill, command, agent, and workflow entries.
- Entries include source and warning metadata.
- Catalog can be consumed without running or loading full skill content.

Validation:

```sh
cd packages/ax-code
bun test test/capability test/cli/skill.test.ts test/cli/debug-agent.test.ts
bun run typecheck
```

## Phase 4: Agent Creation Permission Output

**Status:** Complete.

Goal: stop generating deprecated `tools` frontmatter for new agents.

Tasks:

1. Update `ax-code agent create` to emit `permission` instead of `tools`.
2. Preserve the existing interactive tool-selection UX.
3. Map selected tools to permission rules:
   - selected -> `allow`;
   - unselected -> `deny`;
   - omit `permission` only when all tools are selected and defaults are intended.
4. Keep reading existing `tools` frontmatter for backward compatibility.
5. Add or update tests for non-interactive agent creation.
6. Add a warning in catalog/doctor output for agents using deprecated `tools`.

Files likely touched:

- `packages/ax-code/src/cli/cmd/agent.ts`
- `packages/ax-code/src/agent/agent.ts`
- `packages/ax-code/test/cli/debug-agent.test.ts`
- `packages/ax-code/test/agent/agent.test.ts`

Exit gates:

- New generated agent markdown contains `permission`, not `tools`.
- Existing agent files with `tools` still load.
- Permission behavior remains equivalent for selected/unselected tools.

Validation:

```sh
cd packages/ax-code
bun test test/agent/agent.test.ts test/cli/debug-agent.test.ts
bun run typecheck
```

## Phase 5: Skill Authoring and Doctor CLI

**Status:** Complete.

Goal: make skill authoring and maintenance practical without requiring internal source knowledge.

Tasks:

1. Add `ax-code skill create`.
2. Add `ax-code skill doctor`.
3. Add `ax-code skill test-trigger <prompt>`.
4. Reuse existing validation where possible:
   - standard name;
   - directory/name mismatch;
   - metadata shape;
   - argument hint;
   - allowed tools.
5. Add new doctor checks:
   - missing or vague description;
   - missing referenced relative files;
   - supporting file path escape;
   - duplicate names;
   - oversized `SKILL.md`;
   - excessive path globs.
6. Make `doctor --json` deterministic.
7. Keep `create` LLM-free in MVP.

Files likely touched:

- `packages/ax-code/src/cli/cmd/skill.ts`
- `packages/ax-code/src/skill/index.ts`
- `packages/ax-code/src/skill/doctor.ts`
- `packages/ax-code/test/cli/skill.test.ts`
- `packages/ax-code/test/skill/skill.test.ts`

Exit gates:

- Maintainers can create a valid skill skeleton.
- Doctor catches invalid names, duplicate names, missing references, and invalid metadata.
- Trigger test reports top matches with deterministic reasons.

Validation:

```sh
cd packages/ax-code
bun test test/skill/skill.test.ts test/cli/skill.test.ts
bun run typecheck
```

## Phase 6: Server, SDK, TUI, and Desktop-Ready Catalog Surfaces

**Status:** Partial.

Goal: make the catalog useful in product surfaces without coupling UI to runtime internals.

Tasks:

1. Add a read-only server route for catalog data:
   - `GET /app/capabilities`, or
   - a narrower route set if server route ownership requires it.
2. Generate SDK/OpenAPI types if a new public route is added.
3. Add a TUI command-center view model for catalog items.
4. Add TUI diagnostics for:
   - duplicate names;
   - unsupported compatibility syntax;
   - deprecated agent `tools`;
   - workflow runtime disabled.
5. Keep desktop consumption behind existing SDK/headless contracts.
6. Avoid raw `packages/ax-code/src/**` imports from app/desktop packages.

Files likely touched:

- `packages/ax-code/src/server/routes/*`
- `packages/sdk/js/src/gen/*` or generated SDK outputs
- `packages/ax-code/src/cli/cmd/tui/component/dialog-command.tsx`
- `packages/ax-code/src/cli/cmd/tui/routes/session/display-commands.ts`
- `packages/ax-code/test/server/*.test.ts`
- `packages/ax-code/test/cli/tui/*.test.ts`
- `packages/sdk/js/test/*.test.ts`

Exit gates:

- Catalog is available to app/TUI/SDK through typed read-only data.
- TUI can show separate groups for commands, skills, agents, workflows, and diagnostics.
- No UI surface executes a capability just by listing it.

Validation:

```sh
cd packages/ax-code
bun test test/server test/cli/tui
bun run typecheck
cd ../sdk/js
bun test
bun run typecheck
```

Use focused subsets if the full package-level test set is too broad for the change.

## Phase 7: Workflow-Backed Commands

**Status:** Complete.

Goal: provide a simple command entry point for trusted workflow templates while preserving Workflow Runtime gates.

Tasks:

1. Extend file command frontmatter with `workflow`.
2. Extend `Command.Info` with optional `workflow`.
3. Add parser validation for `WorkflowTemplate.ID`.
4. In command execution:
   - if runtime flag is disabled, return a clear unavailable message;
   - if enabled, create a run from the trusted template;
   - start the run through `WorkflowScheduler`;
   - attach run summary to parent session output.
5. Keep workflow templates declarative JSON; do not parse workflow specs from command markdown.
6. Support raw command body only as prompt/input mapping in a later slice unless the workflow declares a clear `prompt`
   input.
7. Add tests for disabled-runtime and enabled-runtime paths.

Files likely touched:

- `packages/ax-code/src/command/index.ts`
- `packages/ax-code/src/session/prompt-command-execution.ts`
- `packages/ax-code/src/workflow/template.ts`
- `packages/ax-code/src/workflow/scheduler.ts`
- `packages/ax-code/test/cli/workflow.test.ts`
- `packages/ax-code/test/session/prompt-helpers.test.ts`
- `packages/ax-code/test/workflow/template.test.ts`

Exit gates:

- Workflow-backed commands do not run when `AX_CODE_WORKFLOW_RUNTIME` is off.
- Enabled workflow-backed commands create a durable workflow run.
- Candidate/untrusted templates do not run.
- Parent session receives compact state only.

Validation:

```sh
cd packages/ax-code
bun test test/cli/workflow.test.ts test/workflow/template.test.ts test/workflow/scheduler.test.ts
bun run typecheck
```

## Phase 8: Compatibility Importers

**Status:** Complete.

Goal: help users migrate reusable behavior without silently losing unsupported features.

Tasks:

1. Add `ax-code import opencode --dry-run`.
2. Add `ax-code import opencode --write`.
3. Add `ax-code import claude --dry-run`.
4. Add `ax-code import codex --dry-run` if useful as a no-op/canonicalization reporter.
5. Generate migration reports:
   - discovered source files;
   - proposed target files;
   - warnings;
   - unsupported features.
6. Write candidates only with `--write`.
7. Never delete source files.
8. Never enable hooks or workflow routines automatically.
9. Add tests using fixture directories.

Mappings:

- `.opencode/skills` -> `.agents/skills`
- `.opencode/commands` -> `.agents/commands`
- `.opencode/agent` -> `.agents/agents`
- `.claude/skills` -> `.agents/skills`
- `.claude/commands` -> `.agents/commands` when safe
- `.agents/skills` -> already canonical

Files likely touched:

- `packages/ax-code/src/cli/cmd/import.ts`
- `packages/ax-code/src/import/*`
- `packages/ax-code/test/cli/import.test.ts`
- `packages/ax-code/test/fixture/import/*`

Exit gates:

- Dry run is the default-safe workflow.
- Written candidates are deterministic and do not overwrite unless explicitly allowed.
- Unsupported features are visible in text and JSON output.

Validation:

```sh
cd packages/ax-code
bun test test/cli/import.test.ts
bun run typecheck
```

## Phase 9: Evaluation Telemetry Foundation

**Status:** Partial.

Goal: collect enough local evidence for future ADR-024 skill and workflow evaluation without auto-optimizing live files.

Tasks:

1. Record skill recommendation decisions in event/replay data:
   - candidate skills;
   - recommended skills;
   - loaded skill;
   - reason source: explicit, description, path, command, imported.
2. Record command source and warnings in command execution events.
3. Record workflow-backed command run linkage.
4. Add local eval report helpers that read replay/workflow artifacts.
5. Do not generate optimized skill files in this phase.

Files likely touched:

- `packages/ax-code/src/session/system.ts`
- `packages/ax-code/src/tool/skill.ts`
- `packages/ax-code/src/command/index.ts`
- `packages/ax-code/src/replay/*`
- `packages/ax-code/src/workflow/eval.ts`
- `packages/ax-code/test/replay/*.test.ts`
- `packages/ax-code/test/workflow/eval*.test.ts`

Exit gates:

- Replay can explain why a skill or command was selected.
- Data is local and does not expose raw skill content unnecessarily.
- No live skill file is modified by evaluation telemetry.

Validation:

```sh
cd packages/ax-code
bun test test/replay test/workflow/eval.test.ts test/workflow/eval-summary.test.ts
bun run typecheck
```

## Phase 10: Promotion Checklist

**Status:** Partial.

Goal: decide when the capability layer is ready for default product exposure.

Promotion requirements:

- `.opencode` and `.agents` skill discovery have stable tests.
- File-backed command parsing and precedence are stable.
- Catalog route or CLI output is stable enough for TUI/desktop.
- Agent create no longer generates deprecated frontmatter.
- Skill doctor is useful on this repository's built-in skills.
- Workflow-backed commands fail safely when runtime is disabled.
- Importers are dry-run by default and do not overwrite by default.
- No new Effect usage appears outside accepted legacy paths.
- Structure checks pass.

Suggested validation:

```sh
pnpm run check:structure
cd packages/ax-code
bun run typecheck
bun test test/skill/skill.test.ts test/cli/skill.test.ts test/agent/agent.test.ts test/command test/capability
```

Add focused SDK/TUI/server tests depending on which product surfaces changed in the implementation slice.

## First Implementation Slice Recommendation

Start with Phase 1 plus the smallest part of Phase 2:

1. `.opencode/skills` discovery;
2. file-command parser helper with no runtime integration yet;
3. tests for both.

Reason:

- It proves cross-tool compatibility quickly.
- It is low-risk and source-local.
- It does not touch TUI/server/workflow execution yet.
- It creates useful fixtures for catalog work.

## Tracking Table

| Phase | Status | Owner | Depends On | Validation |
| --- | --- | --- | --- | --- |
| 0. Planning baseline | Complete | maintainers | none | planning file checks |
| 1. Skill discovery compatibility | Complete | runtime | Phase 0 | skill/session tests |
| 2. File-backed command discovery | Complete | runtime | Phase 1 | command/session tests |
| 3. Unified capability catalog | Complete | runtime/app | Phase 1-2 | capability/CLI tests |
| 4. Agent creation permission output | Complete | runtime | Phase 0 | agent/CLI tests |
| 5. Skill authoring and doctor CLI | Complete | runtime | Phase 1 | skill/CLI tests |
| 6. Server, SDK, TUI, desktop-ready catalog | Partial | app/runtime | Phase 3 | server/TUI/SDK tests |
| 7. Workflow-backed commands | Complete | workflow | Phase 2-3, ADR-025 gates | workflow/session tests |
| 8. Compatibility importers | Complete | runtime | Phase 1-2, Phase 4 | import CLI tests |
| 9. Evaluation telemetry foundation | Partial | runtime/workflow | Phase 3, ADR-024 | command/session tests |
| 10. Promotion checklist | Partial | maintainers | Phase 1-9 | structure/typecheck/focused tests |

## Open Questions

1. Should `.claude/commands` be auto-discovered, or should it be import-only until unsupported syntax is better mapped?
2. Should `ax-code capability list` be a public command, or should capability catalog stay internal to TUI/server first?
3. Should imported candidates use `.agents` by default even when source files came from `.opencode`?
4. Should workflow-backed commands support frontmatter input mappings in the first implementation, or only template IDs?
5. Should duplicate skill names remain last-write-wins in runtime while catalog shows all collisions?
