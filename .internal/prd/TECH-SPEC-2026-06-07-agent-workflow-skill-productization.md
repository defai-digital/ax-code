# Tech Spec: Agent Workflow and Skill Productization

**Date:** 2026-06-07
**Status:** Implemented - initial productization slice
**Scope:** Internal technical design
**Related:** `.internal/prd/PRD-2026-06-07-agent-workflow-skill-productization.md`, ADR-029, ADR-024, ADR-025,
ADR-027, ADR-028

---

## Summary

Add a productization layer over AX Code's existing skills, commands, agents, and Workflow Runtime. The implementation
should create a unified reusable capability catalog, support file-backed command authoring, modernize agent creation,
add skill diagnostics, and bridge commands to workflow templates without making Workflow Runtime default-on.

The implementation must reuse existing domain modules where possible:

- `src/skill/`
- `src/command/`
- `src/agent/`
- `src/workflow/`
- `src/server/routes/`
- TUI command dialogs and dashboard view models
- SDK/headless contracts

Do not introduce new Effect usage. Keep new code on async/await, Zod, existing Result/error patterns, and thin interface
adapters.

## Current State

### Skills

`Skill` currently:

- discovers external skills under `.claude` and `.agents`;
- scans `skills/**/SKILL.md` in external roots;
- scans `{skill,skills}/**/SKILL.md` in AX Code config directories;
- supports additional `cfg.skills.paths`;
- parses `name`, `description`, `paths`, `license`, `compatibility`, `metadata`, `allowed-tools`, and `argument-hint`;
- exposes `Skill.all()`, `Skill.available(agent)`, `Skill.get(name)`, and `Skill.dirs()`;
- validates standard names and metadata shape;
- recommends skills by path through `Skill.matchByPaths()`;
- exposes full content through the `skill` tool with a sampled file list.

Known gaps:

- no `.opencode` discovery;
- no create/doctor/test-trigger command;
- no trigger-quality metrics;
- duplicate names are logged but not surfaced well in user catalog output.

### Commands

`Command` currently:

- defines built-ins: `init`, `review`, `adr`, `impact`, `prd`, and `goal`;
- reads commands from `cfg.command`;
- exposes MCP prompts as commands;
- exposes skills as command fallbacks when no command with the same name exists;
- supports `agent`, `model`, `description`, `template`, `subtask`, and argument hints.

Known gaps:

- no file-backed command discovery;
- no command catalog route;
- no `workflow` frontmatter;
- no warning model for unsupported compatibility features.

### Agents

`Agent` currently supports:

- `mode: primary | subagent | all`;
- native, hidden, tier, display name, model, variant, prompt, options, steps, permissions;
- built-in primary and subagent definitions;
- custom config agents;
- `ax-code agent create`.

Known gap:

- `agent create` writes deprecated `tools` frontmatter instead of `permission`.

### Workflow Runtime

Workflow Runtime currently supports:

- `WorkflowSpecV1`;
- triggers: manual, scheduled, command, api, webhook-disabled;
- budgets and pacing;
- model policies;
- permissions;
- artifacts;
- verification;
- synthesis;
- phases;
- trusted/candidate templates;
- workflow run state, scheduler, projection, eval, routines, and CLI/server routes.

Known constraints:

- runtime is behind `AX_CODE_WORKFLOW_RUNTIME`;
- built-in templates currently feel like fixtures/previews;
- no slash command bridge exists.

## Target Architecture

Add a reusable capability catalog:

```ts
type CapabilityKind = "instruction" | "skill" | "command" | "agent" | "workflow"

type CapabilityScope = "builtin" | "project" | "user" | "config" | "compat"

type CapabilityWarning = {
  code: string
  message: string
  severity: "info" | "warn" | "error"
}

type CapabilityInfo = {
  kind: CapabilityKind
  name: string
  description?: string
  scope: CapabilityScope
  source?: string
  sourceTool?: "ax-code" | "agents" | "opencode" | "claude" | "codex"
  command?: {
    agent?: string
    model?: string
    subtask?: boolean
    workflow?: string
    hints: string[]
  }
  skill?: {
    paths?: string[]
    recommended?: boolean
    builtin?: boolean
  }
  agent?: {
    mode: "primary" | "subagent" | "all"
    hidden?: boolean
    permissionSummary: string[]
  }
  workflow?: {
    templateID: string
    trust: "candidate" | "trusted"
    requiresRuntimeFlag: boolean
  }
  warnings: CapabilityWarning[]
}
```

This type can start inside a new `src/capability/` domain module or be built as an aggregation layer over existing
services. Keep CLI/TUI/server as adapters.

## Discovery Order

### Skills

Add `.opencode` to external skill roots:

1. builtin skills;
2. user `.agents/skills`;
3. user `.claude/skills`;
4. user `.opencode/skills`;
5. project `.agents/skills` from CWD upward to worktree;
6. project `.claude/skills` from CWD upward to worktree;
7. project `.opencode/skills` from CWD upward to worktree;
8. AX Code config dirs `{skill,skills}/**/SKILL.md`;
9. configured `skills.paths`.

Implementation option:

- Replace `EXTERNAL_DIRS = [".claude", ".agents"]` with a richer source table:

```ts
const EXTERNAL_SKILL_SOURCES = [
  { dir: ".agents", sourceTool: "agents" },
  { dir: ".claude", sourceTool: "claude" },
  { dir: ".opencode", sourceTool: "opencode" },
] as const
```

`Skill.Info` can add optional `sourceTool` and `scope`, or the capability catalog can infer this from the location to
avoid widening the skill runtime shape in the first patch.

### Commands

Add a `CommandDiscovery` helper under `src/command/`:

```ts
type FileCommand = {
  name: string
  description?: string
  agent?: string
  model?: string
  subtask?: boolean
  workflow?: string
  template: string
  location: string
  sourceTool: "ax-code" | "agents" | "opencode" | "claude"
  warnings: CapabilityWarning[]
}
```

Scan:

- `.agents/commands/*.md`
- `.ax-code/commands/*.md`
- `.opencode/commands/*.md`
- `.claude/commands/*.md`

Search upward from CWD to worktree for project-local compatibility folders, matching the skill behavior.

Markdown parsing:

- Use existing `ConfigMarkdown.parse()` where possible.
- Validate frontmatter with Zod.
- Unknown frontmatter fields become warnings, not hard failures.
- Unsupported OpenCode command syntax such as `!` shell injection becomes a warning and leaves the literal text in the
  template, unless later explicitly implemented.

Command precedence:

1. built-in commands;
2. config commands;
3. file commands by source priority;
4. MCP prompts;
5. skill fallback commands.

Built-ins should continue to win unless a future explicit override policy is accepted. OpenCode allows built-in command
override; AX Code should not copy that default until safety and support behavior are clear.

## File-Backed Command Execution

Extend `Command.Info`:

```ts
workflow?: string
location?: string
warnings?: CapabilityWarning[]
```

If a command has no `workflow`, keep current `SessionPrompt.command` path.

If a command has `workflow`:

1. parse `workflow` as `WorkflowTemplate.ID`;
2. if `AX_CODE_WORKFLOW_RUNTIME` is false, publish a structured user-visible unavailable error;
3. resolve input values from command arguments when declared later;
4. call `WorkflowTemplate.createRun()`;
5. call `WorkflowScheduler.start()`;
6. attach run ID and compact summary to parent session output.

MVP input handling:

- pass raw `$ARGUMENTS` as a `prompt` input only if the workflow spec declares an input named `prompt`;
- otherwise ignore command body for workflow execution and show a warning in `doctor`.

## Skill CLI

### `ax-code skill create`

Options:

- `--name`
- `--description`
- `--path`
- `--scope project|user`
- `--compatibility agents|ax-code|claude|opencode`
- `--with references,scripts,templates`

Output:

- created `SKILL.md` path;
- no LLM dependency for MVP;
- optional later skill-creator integration can be separate.

### `ax-code skill doctor`

Input:

- all discovered skills by default;
- `--path` or `--name` filter;
- `--json` output.

Checks:

- standard name regex;
- parent directory/name match;
- duplicate names;
- frontmatter parse errors;
- invalid metadata;
- missing `description`;
- vague descriptions using a small static heuristic;
- `SKILL.md` size threshold warning;
- missing referenced relative files;
- symlink/file escape warnings for supporting files;
- excessive `paths` globs.

### `ax-code skill test-trigger <prompt>`

MVP deterministic scoring:

- token/keyword match against skill name and description;
- path match if prompt includes file-like strings and skill has `paths`;
- report top matches with reasons.

Later LLM-assisted trigger testing belongs in Skill Evaluation and Optimization, not the MVP doctor.

## Agent Create Modernization

Current `agent create` builds a `tools` object where unselected tools become false. Replace generated frontmatter with
`permission`.

Mapping:

```ts
const permission: Record<string, "allow" | "deny"> = {}
for (const tool of AVAILABLE_TOOLS) {
  permission[tool] = selectedTools.includes(tool) ? "allow" : "deny"
}
```

Prefer omitting `permission` if all tools are selected and defaults are intended. If any tool is not selected, include
the full explicit map so the generated file is self-contained.

Backward compatibility:

- continue reading `tools` through config schema;
- add a warning in `agent list` or `doctor` when an agent file uses deprecated `tools`;
- do not rewrite existing files automatically.

## Capability Catalog API

Add a read-only domain service:

```ts
namespace Capability {
  export async function list(input?: { includeWarnings?: boolean }): Promise<CapabilityInfo[]>
  export async function get(kind: CapabilityKind, name: string): Promise<CapabilityInfo | undefined>
}
```

CLI:

- `ax-code capability list`
- or keep user-facing commands as:
  - `ax-code skill list`
  - `ax-code command list`
  - `ax-code agent list`
  - `ax-code workflow templates`

Server route:

- `GET /app/capabilities`
- or separate:
  - `GET /command`
  - existing `GET /skill`
  - existing agent list route if present;
  - workflow template routes behind flag.

Prefer a unified app capability route for desktop/TUI command-center use, while preserving narrow routes for scripting.

## TUI and Desktop View Model

Add a shared view model helper rather than duplicating catalog formatting:

```ts
type CapabilityCatalogItem = {
  title: string
  description: string
  value: string
  kind: CapabilityKind
  sourceLabel: string
  statusLabel: string
  footer?: string
}
```

Display groups:

- Commands;
- Skills;
- Agents;
- Workflows;
- Diagnostics.

Behavior:

- hide workflows when runtime flag is disabled only in quick picker;
- show workflows with "preview disabled" in diagnostics/catalog views;
- show warnings for duplicate names and unsupported compatibility features;
- show permission summary before starting subtask/workflow actions when available.

## Importers

Implement importers as candidate generators:

```bash
ax-code import opencode --dry-run
ax-code import opencode --write
ax-code import claude --dry-run
ax-code import codex --dry-run
```

MVP behavior:

- inspect known directories;
- emit a migration report;
- write candidates only with `--write`;
- never delete original files;
- never enable hooks or workflow routines automatically.

OpenCode mapping:

- `.opencode/skills` -> `.agents/skills`
- `.opencode/commands` -> `.agents/commands`
- `.opencode/agent` or `.opencode/agents` -> `.agents/agents`
- unsupported `!` shell injection -> warning

Claude mapping:

- `.claude/skills` -> `.agents/skills`
- `.claude/commands` -> `.agents/commands`
- subagent-specific extensions -> warning unless directly supported

Codex mapping:

- `.agents/skills` already canonical;
- Codex plugin packaging is not imported in MVP.

## Hooks Boundary

AX Code already has plugin hooks, but does not have a Codex/Claude-style trusted project lifecycle hook browser. This
program should not add broad lifecycle hooks in P0.

Allowed in this PRD:

- catalog representation of plugin hooks if already loaded;
- diagnostics that tell users hooks exist through plugins;
- future ADR stub or follow-up proposal for trusted lifecycle hooks.

Not allowed in this PRD:

- project-local command hooks that run without trust review;
- prompt-based hooks;
- agent-based hooks;
- async background hooks;
- hooks that bypass existing permissions or sandbox.

## Storage and Trust

File-backed commands and skills are instructions, not executable code. They should not require a new trust database in
P0, but their supporting scripts or workflow routines must remain behind existing permission/trust surfaces.

Workflow templates already have `candidate` and `trusted` states. Preserve that model:

- imported workflow templates are candidates;
- saved workflow templates are candidates;
- only trusted templates can run through routines;
- command-triggered workflows require trusted template IDs.

## Testing Plan

### Unit Tests

- skill discovery includes `.opencode/skills`;
- skill source metadata/capability source inference;
- file command parser handles valid frontmatter;
- file command parser warns on unsupported `!` syntax;
- command precedence keeps built-ins safe;
- `agent create` emits `permission`, not `tools`;
- skill doctor catches invalid names, bad metadata, duplicates, and missing references;
- `skill test-trigger` deterministic ranking.

### Integration Tests

Run from `packages/ax-code`:

- `bun test test/skill/skill.test.ts`
- `bun test test/cli/skill.test.ts`
- `bun test test/command/*.test.ts` or new command tests
- `bun test test/agent/agent.test.ts`
- `bun test test/cli/workflow.test.ts` for workflow command bridge when enabled

### Structure and Typecheck

- `pnpm run check:structure`
- `cd packages/ax-code && bun run typecheck`

Do not run root `pnpm test`.

## Migration Plan

1. Add source metadata and `.opencode` skill discovery.
2. Add command discovery behind pure unit tests.
3. Add capability aggregation with CLI JSON output.
4. Update `agent create` output.
5. Add skill doctor/create/test-trigger.
6. Add TUI/server catalog projection.
7. Add workflow-backed command support behind runtime flag.
8. Add importers.
9. Add eval hooks for future ADR-024 implementation.

## Rollback

Rollback is straightforward if changes stay additive:

- remove `.opencode` from skill discovery;
- remove file command discovery from `Command.layer`;
- remove capability route/CLI;
- keep existing config commands and skills unchanged;
- keep Workflow Runtime flag unchanged.

Generated `.agents` files from importers are user files and must not be deleted automatically.

## Open Questions

1. Should command files live under `.agents/commands` by default, or `.ax-code/commands`?
2. Should built-in commands remain non-overridable forever?
3. Should workflow command frontmatter support input mappings in MVP?
4. Should capability catalog live in a new domain module or stay as separate CLI/server aggregation?
5. Should `.claude/commands` be auto-discovered or import-only?
