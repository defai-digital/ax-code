# ADR-029: Productize Skills, Commands, Agents, and Workflows as One Reusable Capability Layer

## Status

Accepted

## Date

2026-06-07

## Deciders

ax-code maintainers

## Related

- `.internal/prd/PRD-2026-06-07-agent-workflow-skill-productization.md`
- `.internal/prd/TECH-SPEC-2026-06-07-agent-workflow-skill-productization.md`
- `.internal/adr/ADR-024-skill-evaluation-optimization-boundary.md`
- `.internal/adr/ADR-025-workflow-runtime-boundary.md`
- `.internal/adr/ADR-027-opencode-low-risk-feature-learning-boundary.md`
- `.internal/adr/ADR-028-task-queue-layering-boundary.md`

## Context

Codex, Claude Code, and OpenCode have converged on a reusable agent behavior model:

- always-on repository instructions;
- on-demand skills;
- user-invocable slash/custom commands;
- primary agents and subagents;
- deterministic hooks or lifecycle automation;
- plugins or packaging for distribution.

OpenCode now has native Agent Skills and reads multiple compatibility layouts, including `.opencode/skills`,
`.claude/skills`, and `.agents/skills`. It also uses file-backed `.opencode/command/*.md` and `.opencode/agent/*.md`
inside its own repository. Claude Code has merged custom commands into skills while still preserving command
compatibility, and frames hooks as deterministic automation. Codex uses progressive-disclosure skills, plugins for
distribution, hooks, and explicit subagent workflows.

AX Code already has the lower-level runtime substrate:

- `AGENTS.md` initialization;
- skill discovery and the `skill` tool;
- built-in/config/MCP/skill commands;
- primary agents, subagents, permissions, hidden tiers, and model options;
- task tool child sessions;
- plugin hooks;
- Workflow Runtime schemas, templates, runs, routines, artifacts, budgets, verification, and eval;
- verification envelopes, replay, DRE, rollback, and review evidence.

However, these primitives are spread across separate runtime areas. Users currently do not get a simple product answer
to "where should I put this reusable behavior?" or "how do I run and verify this workflow again?"

The decision needed is whether to:

1. continue treating skills, commands, agents, and workflows as separate internal features;
2. copy OpenCode/Claude/Codex feature shapes directly;
3. productize AX Code's existing primitives as a unified reusable capability layer.

## Decision

AX Code will productize skills, commands, agents, and workflow templates as one reusable capability layer.

The canonical model is:

| Layer | Purpose | Canonical path |
| --- | --- | --- |
| Instructions | Always-on repo guidance | `AGENTS.md` |
| Skills | On-demand instructions, knowledge, and workflow runbooks | `.agents/skills/<name>/SKILL.md` |
| Commands | User-invocable prompt templates | `.agents/commands/<name>.md` |
| Agents | Role, model, mode, and permission profiles | `.agents/agents/<name>.md` or existing AX Code config |
| Workflow templates | Durable multi-agent orchestration | `.ax-code/workflow-template/<id>.json` |

AX Code will add compatibility discovery/import for OpenCode and Claude Code where the shape is safe:

- read `.opencode/skills`;
- read `.opencode/commands` as prompt-only command templates;
- optionally read or import `.claude/commands` where the file maps cleanly;
- keep `.agents` as the preferred cross-tool format.

Workflow Runtime remains the durable orchestration boundary. Commands may trigger workflow templates, but workflow specs
remain declarative JSON templates with trust state and runtime gates. Skills remain progressive-disclosure instruction
bundles, not arbitrary executable workflow scripts.

Hooks are not accepted as a broad new project-local lifecycle feature in this ADR. AX Code may expose existing plugin
hooks in diagnostics, but Codex/Claude-style trusted lifecycle hooks require a separate ADR because they add new
execution timing, trust review, and security responsibilities.

Skill Evaluation and Optimization remains governed by ADR-024: offline-only, verifier-gated, candidate-output-only, and
based on replay/workflow evidence.

## Rationale

This direction matches the market trend without copying external runtime architecture.

OpenCode demonstrates the value of simple file-backed commands and agents. Claude Code demonstrates the value of clear
extension layering: persistent instructions, skills, subagents, MCP, hooks, and plugins each solve different problems.
Codex demonstrates progressive disclosure, plugins as distribution units, and explicit subagent workflows.

AX Code can adopt the useful product shape while keeping its own advantages:

- local-first sandbox and permissions;
- server-owned sessions and event replay;
- durable task queue and workflow runtime;
- verification envelopes and review evidence;
- app/headless SDK boundary;
- Effect freeze and package boundary rules.

A unified capability layer reduces user confusion and gives the desktop/TUI command center a coherent data model. It
also creates a safer path for migration from OpenCode/Claude/Codex setups because unsupported features can be reported
instead of silently misinterpreted.

## Consequences

Positive:

- Users get one mental model for reusable AX Code behavior.
- Skills, commands, agents, and workflows become visible in one catalog.
- AX Code gains OpenCode/Claude/Codex compatibility where it is low-risk.
- Workflow Runtime gets a practical entry point through command-backed templates.
- Agent creation aligns with the current `permission` schema.
- Skill quality can improve through doctor/test-trigger/eval loops.
- AX Code differentiates through evidence and verification instead of vendor feature cloning.

Negative or risky:

- Discovery precedence and duplicate names become more important.
- Compatibility folders may surprise users if AX Code reads files intended for another tool.
- File-backed commands can become a hidden prompt surface if catalog diagnostics are weak.
- Workflow-backed commands may confuse users while Workflow Runtime remains feature-flagged.
- Importers can create stale candidate files if users do not understand unsupported features.

## Accepted Boundaries

1. **Prompt-only command files first.**
   Do not implement OpenCode-style shell-output interpolation in the first slice.

2. **Canonical `.agents`, AX Code-owned workflows.**
   `.agents` is preferred for portable skills/commands/agents. Workflow templates stay under `.ax-code` because they
   are AX Code runtime state with trust and durable orchestration semantics.

3. **Compatibility is labeled.**
   Entries loaded from `.opencode` or `.claude` must surface source metadata and warnings when features are unsupported.

4. **Built-ins stay protected.**
   Built-in commands should not be overridden by compatibility command files unless a later ADR accepts that behavior.

5. **Workflow Runtime remains gated.**
   Workflow-backed commands must fail clearly when `AX_CODE_WORKFLOW_RUNTIME` is disabled.

6. **No new lifecycle hooks in this ADR.**
   Trusted hooks require a separate security/runtime decision.

7. **No live skill auto-optimization.**
   Skill optimization may produce candidate files and reports only.

## Alternatives Considered

### Keep each primitive separate

Rejected. It preserves current runtime boundaries but does not solve user adoption, migration, catalog, or command-center
clarity.

### Copy OpenCode directly

Rejected. OpenCode is a useful product signal, but AX Code has different runtime boundaries, security posture, app
contracts, and Effect freeze requirements.

### Treat skills as the workflow system

Rejected. Skills are good for instructions and runbooks. Durable multi-agent execution needs Workflow Runtime state,
budgets, artifacts, verification, and resume/cancel/retry behavior.

### Turn Workflow Runtime on by default now

Rejected. ADR-025 still owns runtime readiness. This ADR adds product entry points without bypassing preview gates.

### Add hooks first

Rejected for this scope. Hooks are powerful but create new trust and execution-order risks. Commands/skills/catalog are
lower risk and solve the immediate product gap.

### Make `.ax-code` the only supported authoring layout

Rejected. It would reduce compatibility with the emerging Agent Skills ecosystem. AX Code should own runtime-specific
state under `.ax-code`, but reusable skills and command runbooks should be portable where possible.

## Implementation Notes

- Add `.opencode` skill discovery with focused tests.
- Add command file discovery under `src/command/`.
- Add a capability catalog aggregation service or helper.
- Update `ax-code agent create` to emit `permission`.
- Add `skill create`, `skill doctor`, and `skill test-trigger`.
- Expose catalog data through CLI and app/headless surfaces.
- Add workflow-backed command frontmatter after file-backed commands are stable.
- Keep importers dry-run by default.

## Rollback

Rollback means:

- remove compatibility source discovery;
- remove file command discovery;
- remove capability catalog routes/view models;
- keep existing config commands, built-in commands, skill discovery, and Workflow Runtime unchanged.

User-generated `.agents` files should not be deleted automatically.

## Acceptance Criteria

- PRD, tech spec, and ADR exist and are indexed.
- `.opencode/skills` compatibility is implemented or explicitly deferred with tests pending.
- File-backed command discovery has parser, precedence, and warning tests.
- New generated agent files use `permission`.
- Catalog output can distinguish skill, command, agent, and workflow entries.
- Workflow-backed commands respect `AX_CODE_WORKFLOW_RUNTIME`.
- Unsupported imported features are reported as warnings.
- No new Effect usage is introduced outside accepted legacy areas.

## Open Questions

1. Should `.claude/commands` be auto-discovered or import-only?
2. Should AX Code ever support shell-output interpolation in command templates?
3. Should built-in command override be allowed for trusted projects?
4. Should capability catalog be a stable public SDK contract in the first implementation slice?
5. Should workflow template authoring eventually support YAML/Markdown frontmatter, or remain JSON-only?
