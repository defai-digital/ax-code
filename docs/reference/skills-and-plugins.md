# Skill / plugin catalog

Status: Active
Scope: public, current-state
Last reviewed: 2026-08-12
Owner: AX Code runtime

Discoverable registry of built-in skills and how to add project skills.

The default `/` menu is a control plane (`/plan`, `/review`, `/debug`, `/status`, `/model`). Older built-in skills stay agent-only (skill tool). The backend reliability pack is also listed as slash commands.

## Built-in skills (shipped under `packages/ax-code/skills/`)

| Skill                    | Purpose                                                      | Slash                     |
| ------------------------ | ------------------------------------------------------------ | ------------------------- |
| `debug-n-fix`            | Debug then fix with verification                             | Use `/debug`              |
| `debug-only`             | Investigation without code changes                           | Agent-only                |
| `improve-overall`        | Broad quality improvements                                   | Agent-only                |
| `improve-security`       | Security-focused improvements                                | Agent-only                |
| `mcp`                    | MCP setup guidance                                           | Use `/mcp`                |
| `run`                    | Launch and observe the app                                   | Agent-only                |
| `simplify`               | Tighten recently changed code                                | Agent-only                |
| `verify`                 | Runtime verification report                                  | Agent-only                |
| `verified-change`        | Edit only after a failing signal, then re-run the same check | `/verified-change`        |
| `safe-db-migration`      | Expand/backfill/contract schema changes with rollback notes  | `/safe-db-migration`      |
| `api-contract`           | Additive-first public API / schema evolution                 | `/api-contract`           |
| `incident-observability` | Evidence-first incident diagnosis before a patch             | `/incident-observability` |
| `auth-boundaries`        | Authn/authz, tenant isolation, negative tests                | `/auth-boundaries`        |
| `queue-worker`           | Idempotent queue/worker changes and duplicate delivery       | `/queue-worker`           |

Skills use `SKILL.md` with YAML frontmatter (`name`, `description`, optional `paths`, `allowed-tools`).

## Project skills

Place skills under any of:

- `.ax-code/skill/<name>/SKILL.md` or `.ax-code/skills/<name>/SKILL.md`
- `.agents/skills/<name>/SKILL.md` (Agents / Codex compat)
- `.claude/skills/<name>/SKILL.md` (Claude Code compat)
- `.opencode/skills/<name>/SKILL.md`

List and validate:

```bash
ax-code            # TUI skill dialog
# or use the skill tool from a session
```

## Plugins

Configure plugins in `ax-code.json`:

```json
{
  "plugin": ["file:///absolute/path/to/plugin.js"]
}
```

Plugins implement `@ax-code/plugin` hooks (`tool.execute.before`, `tool.execute.after`, `shell.env`, auth, etc.).

### Callback lifetime

Plugin factories receive optional `lifecycle` in their input. `lifecycle.signal` aborts when the instance is disposed
or the plugin is retired. Register timers, watchers, and subscriptions with `lifecycle.onDispose(cleanup)`. The returned
function unregisters that cleanup. Registrations run at most once; registering after disposal starts cleanup immediately.
Cleanup callbacks start in reverse registration order, each with a one-second budget, and may finish concurrently.

Transform hooks receive an optional third argument, `{ signal }`; config and event hooks receive it as their second
argument. This signal cancels work while the callback is pending; use `lifecycle.signal` for work owned by the plugin
beyond one callback. Pass signals to abortable operations. Initialization, config, event, and transform callbacks have a
15-second deadline. A timeout retires the plugin for that instance and aborts its lifetime. Existing factories and
two-argument transform hooks continue to work. Custom tool execution and interactive authentication retain their
existing execution contracts.

Transform inputs are read-only observations of plain data. Mutate the output draft and await all changes before
returning. Successful output mutations become visible in registration order; failed or late changes are discarded.
Event payload changes are never published. A permission denial remains a denial, and failed or retired permission
hooks require asking unless a denial already exists.

Arrays and plain objects are detached from runtime state. Schemas, functions, and class instances retain identity and
must be treated as read-only. Plugins remain trusted JavaScript running in the runtime process: cancellation is
cooperative and cannot stop synchronous infinite loops or undo external effects.

## Hooks packs

See [Hooks](../guides/hooks.md) for the five official lifecycle packs (`format-after-edit`, `block-force-push`, `require-tests-on-stop`, `protect-env-files`, `log-bash-commands`).

## Eval harness

Run the agentic runtime gate suite and multi-mode ensemble policy suite:

```bash
cd packages/ax-code
pnpm exec vitest run test/harness/agentic-runtime-eval.test.ts
pnpm exec vitest run test/harness/multi-mode-ensemble-eval.test.ts
```

See also [Execution Modes](../guides/modes.md) for local/cloud/hybrid/council/arena.
