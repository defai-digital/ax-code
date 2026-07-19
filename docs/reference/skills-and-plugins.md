# Skill / plugin catalog

Status: Active
Scope: public, current-state
Last reviewed: 2026-07-19
Owner: AX Code runtime

Discoverable registry of built-in skills and how to add project skills.

## Built-in skills (shipped under `packages/ax-code/skills/`)

| Skill              | Purpose                            |
| ------------------ | ---------------------------------- |
| `debug-n-fix`      | Debug then fix with verification   |
| `debug-only`       | Investigation without code changes |
| `improve-overall`  | Broad quality improvements         |
| `improve-security` | Security-focused improvements      |
| `mcp`              | MCP setup guidance                 |

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
