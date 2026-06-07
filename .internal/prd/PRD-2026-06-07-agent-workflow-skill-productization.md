# PRD: Agent Workflow and Skill Productization

**Date:** 2026-06-07
**Status:** Draft - proposal
**Scope:** Internal
**Owner:** ax-code maintainers
**Related:** ADR-029, ADR-024, ADR-025, ADR-027, ADR-028,
`.internal/prd/TECH-SPEC-2026-06-07-agent-workflow-skill-productization.md`,
`.internal/prd/PLAN-2026-06-07-agent-workflow-skill-productization-implementation.md`,
`.internal/prd/PRD-2026-05-29-workflow-runtime.md`,
`.internal/prd/PRD-2026-05-29-skill-evaluation-optimization.md`
**Archive criteria:** Archive when AX Code ships a repo-native reusable workflow surface that lets maintainers discover,
create, validate, invoke, and supervise skills, commands, agents, and workflow templates through the same runtime
contracts, with compatibility import paths for OpenCode, Claude Code, and Codex-style agent skills.

---

## Purpose

Make AX Code's reusable agent behavior obvious and dependable.

Codex, Claude Code, and OpenCode have converged on a layered model:

- always-on project instructions;
- on-demand skills;
- invocable slash/custom commands;
- primary agents and subagents;
- deterministic hooks or lifecycle automation;
- plugin packaging for reuse across projects.

AX Code already has many of these primitives, but they are not yet packaged as a single product loop. This PRD turns the
existing substrate into a user-facing command center and file-backed authoring model while preserving AX Code's
local-first security, evidence, verification, and workflow runtime boundaries.

## Problem

Users do not judge AX Code by whether a primitive exists in source code. They judge whether they can:

1. understand where reusable behavior belongs;
2. create a reusable workflow without reading runtime internals;
3. invoke it from TUI, CLI, SDK, or app surfaces;
4. supervise what it did;
5. verify that it completed correctly;
6. share or migrate it across tools without rewriting everything.

Current AX Code gaps:

- Skills exist, but the CLI only lists and validates them.
- Skill discovery supports `.claude` and `.agents`, but not `.opencode`.
- Commands exist in config, MCP prompts, and skill fallback commands, but file-backed command authoring is not a clear
  product surface.
- Workflow Runtime exists behind `AX_CODE_WORKFLOW_RUNTIME`; its schema is powerful but feels internal/preview.
- The desktop/TUI command center does not present commands, skills, agents, and workflow templates as one reusable
  capability catalog.
- `ax-code agent create` still writes deprecated `tools` frontmatter even though config schema points users toward
  `permission`.
- Skill evaluation is correctly deferred behind workflow/evidence traces, but there is no simple "skill doctor" or
  trigger-quality loop for maintainers today.

Without this productization layer, AX Code risks looking behind Codex, Claude Code, and OpenCode despite having stronger
runtime evidence, sandboxing, replay, task queue, and workflow foundations.

## Research Inputs

External references reviewed on 2026-06-07:

- OpenCode Agent Skills: <https://dev.opencode.ai/docs/skills>
- OpenCode Commands: <https://opencode.ai/docs/commands/>
- OpenCode Agents: <https://opencode.ai/docs/agents/>
- Claude Code extension overview: <https://code.claude.com/docs/en/features-overview>
- Claude Code skills: <https://code.claude.com/docs/en/skills>
- Claude Code hooks: <https://code.claude.com/docs/en/hooks-guide>
- Codex manual: <https://developers.openai.com/codex/codex-manual.md>

Local AX Code sources reviewed:

- `packages/ax-code/src/skill/index.ts`
- `packages/ax-code/src/tool/skill.ts`
- `packages/ax-code/src/command/index.ts`
- `packages/ax-code/src/cli/cmd/skill.ts`
- `packages/ax-code/src/cli/cmd/agent.ts`
- `packages/ax-code/src/workflow/spec.ts`
- `packages/ax-code/src/workflow/fixtures.ts`
- `packages/ax-code/src/workflow/template.ts`
- `packages/ax-code/src/flag/flag.ts`
- `packages/plugin/src/index.ts`
- `.internal/reference/opencode/.opencode/command/commit.md`
- `.internal/reference/opencode/.opencode/agent/triage.md`

## Current AX Code Substrate

AX Code already has:

- `AGENTS.md` repo guidance through `/init`.
- Built-in and external skills loaded through `Skill.available()` and the `skill` tool.
- Skill metadata fields such as `paths`, `allowed-tools`, `argument-hint`, `license`, `compatibility`, and `metadata`.
- Built-in commands such as `/review`, `/prd`, `/adr`, `/impact`, `/goal`, plus config commands and MCP prompts.
- Skill names exposed as slash command fallbacks when no command of the same name exists.
- Built-in primary agents and subagents with permissions, modes, hidden/internal tiers, model options, and routing.
- Task tool child sessions with nesting limits, abort propagation, permission gates, and subagent resumption.
- Workflow Runtime schema with triggers, budgets, pacing, model policy, permissions, artifacts, verification, synthesis,
  and phases.
- Built-in workflow fixtures for `noop-dry-run`, `issue-triage`, and `verified-bug-sweep`.
- Plugin hooks for chat, commands, permissions, tool execution, system transforms, and tool definitions.
- Verification envelopes, review results, DRE, rollback, replay, and event projection foundations.

The missing layer is a coherent product contract that tells users what to author, where to place it, how AX Code trusts
it, and how the runtime proves that it worked.

## Goals

1. Make reusable agent behavior first-class across CLI, TUI, SDK/server, and desktop app surfaces.
2. Define a canonical file-backed layout for skills, commands, agents, and workflow templates.
3. Add compatibility discovery/import for OpenCode and Claude Code where the shape is safe and maps cleanly.
4. Present commands, skills, agents, and workflow templates in one catalog with source, trust, scope, permissions, and
   recommended invocation state.
5. Improve authoring ergonomics with `create`, `doctor`, and trigger-test commands.
6. Keep Workflow Runtime as the durable orchestration boundary, not a script runner.
7. Keep Skill Evaluation and Optimization offline, verifier-gated, and evidence-backed per ADR-024.
8. Let AX Code differentiate through evidence: verification envelopes, artifacts, replay, and eval metrics.

## Non-Goals

- Do not copy OpenCode runtime architecture or Effect usage.
- Do not enable arbitrary workflow JavaScript execution.
- Do not turn skills into unrestricted code execution bundles.
- Do not make Workflow Runtime default-on until ADR-025 gates are satisfied.
- Do not add remote workspace forwarding, public webhook execution, or cloud-hosted workflow services in this PRD.
- Do not add provider OAuth or websocket transport work.
- Do not auto-edit live skills as part of skill optimization.
- Do not expose raw skill content or internal paths in public docs or unauthenticated app surfaces.

## Target Users

- AX Code maintainers building repeatable internal workflows.
- Power users migrating reusable prompts from OpenCode, Claude Code, or Codex.
- Desktop/TUI users who need a command center instead of remembering config paths.
- Teams that want repo-scoped agent behavior checked into source control.
- Integrators using SDK/server APIs to list and invoke reusable runtime capabilities.

## Product Model

AX Code should expose five durable surfaces:

| Surface | Job | Example | First-class authoring path |
| --- | --- | --- | --- |
| Instructions | Always-on repository guidance | "Use pnpm, not npm" | `AGENTS.md` |
| Skill | On-demand knowledge or workflow instructions | `debug-n-fix` | `.agents/skills/<name>/SKILL.md` |
| Command | User-invocable prompt template | `/commit`, `/review-pr` | `.agents/commands/<name>.md` |
| Agent | Role, model, mode, and permission profile | `security`, `triage` | `.agents/agents/<name>.md` or existing config |
| Workflow template | Durable multi-agent orchestration | `verified-bug-sweep` | `.ax-code/workflow-template/<id>.json` |

AX Code can continue reading existing `.ax-code` config locations. `.agents` should be the cross-tool canonical authoring
path because it aligns with the open Agent Skills standard and can coexist with OpenCode/Codex-compatible layouts.

## Requirements

### P0: Cross-Tool Discovery and Catalog

- Add `.opencode/skills/<name>/SKILL.md` to skill discovery.
- Keep `.agents/skills` as the preferred canonical repo path.
- Add file-backed command discovery from:
  - `.agents/commands/*.md`
  - `.ax-code/commands/*.md`
  - `.opencode/commands/*.md`
  - optional `.claude/commands/*.md` compatibility when the file maps to a prompt-only command.
- List catalog entries with:
  - type: instruction, skill, command, agent, workflow template;
  - name;
  - description;
  - scope: builtin, project, user, external-compatible;
  - source path;
  - permission impact;
  - trust status when applicable;
  - recommended state when path or context matching applies.
- Expose catalog data through CLI, TUI, server/SDK, and desktop-ready contracts.

### P0: File-Backed Commands

File-backed command markdown must support frontmatter:

```yaml
---
description: Review the current branch before merge
agent: security
model: openai/gpt-5
subtask: true
---
Review $ARGUMENTS and produce actionable findings with file references.
```

Required behavior:

- command name derives from file name;
- `$ARGUMENTS` and positional `$1`, `$2` substitutions behave like config commands;
- `agent`, `model`, and `subtask` follow current `Command.Info` semantics;
- command content is a prompt template only in the first slice;
- shell-output interpolation from OpenCode `!` command syntax is not accepted in P0.

### P0: Agent Creation Modernization

- Update `ax-code agent create` to write `permission` instead of deprecated `tools`.
- Preserve backward compatibility for existing `tools` config.
- Add non-interactive output that is deterministic enough for tests and docs.
- Include `mode`, `hidden`, `description`, `model`, `color`, and `permission` in the generated markdown where selected.

### P0: Skill Authoring and Diagnosis

Add or improve:

- `ax-code skill create`
- `ax-code skill doctor`
- `ax-code skill test-trigger <prompt>`
- `ax-code skill list --json` output with source and warning details

The doctor should flag:

- invalid standard name;
- directory/name mismatch;
- missing or vague description;
- oversized `SKILL.md`;
- invalid metadata;
- missing referenced files;
- unsafe paths outside skill base;
- too many always-on matching patterns;
- duplicate skill names.

### P1: Command Center UX

TUI and desktop command-center surfaces should show:

- Commands tab;
- Skills tab;
- Agents tab;
- Workflows tab;
- Diagnostics tab for warnings and incompatible entries.

Each entry should show:

- source and scope;
- short description;
- expected invocation style;
- permission summary;
- whether it can run as subtask;
- whether it requires Workflow Runtime flag;
- warning count.

### P1: Workflow Command Bridge

Allow command frontmatter to reference workflow templates:

```yaml
---
description: Run verified bug sweep
workflow: builtin:verified-bug-sweep
subtask: true
---
Sweep $ARGUMENTS for confirmed bugs and return verified findings only.
```

Behavior:

- If `AX_CODE_WORKFLOW_RUNTIME` is disabled, command returns a clear unavailable message with enablement guidance.
- If enabled, command creates and starts a workflow run through `WorkflowTemplate.createRun()` and `WorkflowScheduler`.
- Parent session receives compact workflow run state and final exposed artifacts.
- Workflow templates remain JSON specs, not markdown scripts.

### P1: Compatibility Import

Add import/doctor flows:

- `ax-code import opencode`
- `ax-code import claude`
- `ax-code import codex`

The import should produce candidate files under `.agents` or `.ax-code` and report unsupported features rather than
silently dropping them.

Unsupported in P1:

- OpenCode command shell-output interpolation;
- Claude dynamic context injection;
- Claude prompt-based hooks;
- remote/managed enterprise policy;
- arbitrary plugin packaging conversion.

### P2: Skill and Workflow Evaluation

Build on ADR-024:

- record trigger decisions and skill loads in event/replay data;
- evaluate trigger precision/recall from local prompt corpora;
- compare skill-assisted runs against baseline runs;
- require verification envelopes for workflow optimization;
- generate candidate `best_skill.md`, diffs, and reports;
- never auto-write live skills.

## Acceptance Criteria

- `ax-code skill list` shows `.opencode`, `.claude`, `.agents`, builtin, and config-path skills with source metadata.
- File-backed commands from `.agents/commands` and `.opencode/commands` can be listed and invoked.
- `ax-code agent create` writes `permission`, not `tools`, for new agents.
- The TUI command dialog or command center distinguishes skills, commands, agents, and workflow templates.
- A command can be marked `subtask: true` and run without polluting the primary context when its selected agent allows it.
- A workflow-backed command produces a deterministic unavailable message while Workflow Runtime is disabled.
- Skill doctor catches invalid standard names, duplicate names, bad metadata, and stale references.
- Importers produce candidate files and unsupported-feature reports.
- No implementation introduces new Effect usage outside accepted legacy areas.
- No implementation grants network, shell, or remote capabilities without explicit existing permission gates.

## Phasing

### Phase 0: Product Contract

- Land this PRD, tech spec, and ADR.
- Add catalog terminology to internal docs.
- Decide canonical file locations and compatibility discovery order.

### Phase 1: Discovery and Commands

- Add `.opencode/skills` discovery.
- Add file-backed commands.
- Add catalog list output.
- Add tests around precedence and collisions.

### Phase 2: Authoring Tools

- Modernize `agent create`.
- Add `skill create`, `skill doctor`, and `skill test-trigger`.
- Add import candidate reports.

### Phase 3: Command Center

- Expose catalog through server/SDK.
- Add TUI/desktop-ready view models.
- Add warnings and permission summaries.

### Phase 4: Workflow Bridge

- Add workflow-backed command frontmatter.
- Keep runtime behind `AX_CODE_WORKFLOW_RUNTIME`.
- Surface final artifacts and verification envelopes.

### Phase 5: Evaluation

- Build local skill/workflow eval from replay and workflow artifacts.
- Produce candidate optimization reports only.

## Risks

| Risk | Mitigation |
| --- | --- |
| Catalog becomes another large config system | Keep files simple and map to existing `Command`, `Skill`, `Agent`, and `WorkflowTemplate` types |
| Cross-tool compatibility creates surprising behavior | Compatibility sources are labeled; unsupported features produce warnings |
| Skill descriptions crowd prompt context | Keep current progressive disclosure and add diagnostics for vague/long descriptions |
| File-backed commands become shell execution | P0 commands are prompt templates only; shell-output interpolation is explicitly deferred |
| Workflow templates feel too heavy for simple commands | Commands remain the lightweight entry; workflows only for durable multi-agent runs |
| Skill evaluation overfits | Keep evaluation offline, verifier-gated, and candidate-only |

## Open Questions

1. Should `.agents/commands` be the canonical command path, or should AX Code prefer `.ax-code/commands` for product
   ownership while reading `.agents/commands` for portability?
2. Should skill name collisions keep the current last-write behavior, or should catalog display all collisions while the
   model sees only the selected winner?
3. Should command shell-output interpolation ever be supported, or should AX Code require explicit tool calls for audit?
4. Should workflow-backed commands be visible when `AX_CODE_WORKFLOW_RUNTIME` is disabled?
5. Should importers write candidate files by default or only print a migration plan unless `--write` is passed?
