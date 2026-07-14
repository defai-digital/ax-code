# Repo Wiki (OpenWiki)

Status: Active  
Scope: current-state  
Last reviewed: 2026-07-14  
Owner: ax-code runtime

AX Code integrates [LangChain OpenWiki](https://github.com/langchain-ai/openwiki) as an optional **semantic repository wiki**. The wiki is a multi-page markdown knowledge base under `openwiki/` that agents read for architecture and design intent.

It is **not** a replacement for structural code intelligence (`ax-code index` / `code_intelligence` / `lsp`). See also [Semantic Layer](semantic-layer.md).

## Why a wiki?

Instruction files like `AGENTS.md` should stay **thin**: build commands, safety rules, style. They should not hold hundreds of pages of architecture notes.

OpenWiki follows the LLM Wiki pattern: compile repo understanding into interlinked markdown once, keep it updated, and let agents drill from an index instead of rediscovering structure every session.

## Knowledge routing

| Need | Prefer |
|------|--------|
| Build / test / safety / style | `AGENTS.md` |
| Architecture, module intent, design narrative | `openwiki/` (start at `quickstart.md` or `index.md`) |
| Precise symbols, callers, callees, references | `code_intelligence` / `lsp` (`ax-code index`) |
| Preferences and past decisions | Project memory (`.ax-code/memory.json`) |

If wiki content and code disagree, **trust the code** (and graph/LSP), then refresh the wiki.

## Prerequisites

1. Install the OpenWiki CLI (external tool):

   ```bash
   npm install -g openwiki
   ```

2. Configure a model provider and API key for OpenWiki (typically `~/.openwiki/.env`). See the [OpenWiki README](https://github.com/langchain-ai/openwiki).

3. AX Code does **not** vendor OpenWiki or its model keys. Generation runs as a host process outside the AX Code sandbox.

## Commands

| Command | Purpose |
|---------|---------|
| `ax-code wiki status` | Show wiki directory + OpenWiki binary status |
| `ax-code wiki doctor` | Health checks and remediation hints |
| `ax-code wiki ensure-agents` | Inject/update `<!-- OPENWIKI:… -->` markers in `AGENTS.md` (and `CLAUDE.md` if present) |
| `ax-code wiki generate` | Create or refresh the wiki via OpenWiki |
| `ax-code wiki update` | Incremental update via OpenWiki |
| `ax-code init --wiki` | Thin `AGENTS.md` + markers + generate when CLI is available |
| `ax-code init --wiki --wiki-only-agents` | Markers only (skip generate) |

Useful flags:

- `--directory <path>` — project root (default: cwd)
- `--command <bin>` — OpenWiki executable (default: `openwiki`, or `OPENWIKI_COMMAND`)
- `--skip-agents` — do not rewrite AGENTS markers after generate/update
- `--quiet` — buffer OpenWiki output until completion (disables live stream and 15s heartbeats)
- `--json` — machine-readable output for `status` / `doctor`
- `--dry-run` — preview `ensure-agents` without writing

Generate/update stream OpenWiki stdout/stderr live and print a heartbeat every 15s while the process is quiet (long LLM jobs).

In the interactive TUI, `/wiki` guides the same flows.

## Typical workflow

```bash
# 1. Thin project instructions
ax-code init

# 2. Bootstrap semantic wiki (or: ax-code init --wiki)
ax-code wiki generate

# 3. Structural graph for precise navigation (independent)
ax-code index

# 4. After substantial code changes
ax-code wiki update
```

When `openwiki/` already exists, a plain `ax-code init` (without `--wiki`) will still soft-inject the OpenWiki marker block into `AGENTS.md` if it is missing, so agents keep the wiki pointer without regenerating docs.

## What gets written

| Path | Role |
|------|------|
| `openwiki/**/*.md` | Wiki pages (OpenWiki owns content) |
| `openwiki/.last-update.json` | Optional metadata (if OpenWiki writes it) |
| `AGENTS.md` / `CLAUDE.md` | Only the `<!-- OPENWIKI:START -->` … `<!-- OPENWIKI:END -->` span is managed by `ensure-agents` |

User content **outside** those markers is never clobbered.

## Session behavior

When `openwiki/` is present and `wiki.enabled` is not `false`, AX Code injects a `<repo_wiki>` system block that tells the agent to:

1. Start from the wiki index for architecture questions
2. Use `code_intelligence` / `lsp` for precise symbols
3. Prefer code when wiki and source disagree

## Configuration

In `ax-code.json` (or project config):

```json
{
  "wiki": {
    "enabled": true,
    "command": "openwiki",
    "dir": "openwiki",
    "autoInjectAgents": true,
    "touchClaudeMd": true
  }
}
```

| Key | Default | Meaning |
|-----|---------|---------|
| `enabled` | true (effective) | Inject `<repo_wiki>` when the wiki directory exists |
| `command` | `openwiki` | Executable name or path (`OPENWIKI_COMMAND` overrides when unset) |
| `dir` | `openwiki` | Wiki directory relative to project root |
| `autoInjectAgents` | true | Allow ensure-agents / init paths to rewrite markers |
| `touchClaudeMd` | true | Also update `CLAUDE.md` when it already exists |

## Relationship to indexing

| | `ax-code wiki` | `ax-code index` |
|--|----------------|-----------------|
| Artifact | Markdown under `openwiki/` | SQLite code graph |
| Strength | Synthesized architecture narrative | Structural precision |
| Cost | LLM generate/update (OpenWiki) | Local LSP/graph indexing |
| Freshness | Explicit `wiki update` | Watcher + re-index |

Do not use the wiki alone for rename impact, call-graph proof, or refactor blast radius. Use `code_intelligence` / `lsp`.

## Troubleshooting

| Symptom | What to try |
|---------|-------------|
| `OpenWiki CLI not found` | `npm install -g openwiki`; or set `wiki.command` / `OPENWIKI_COMMAND` |
| Generate fails with auth errors | Configure OpenWiki provider keys in `~/.openwiki/.env` |
| Wiki present but agents ignore it | Run `ax-code wiki ensure-agents`; check `wiki.enabled` |
| AGENTS.md got too large | Keep architecture in `openwiki/`; leave only rules/commands in AGENTS |
| Stale wiki after big refactors | `ax-code wiki update` |

```bash
ax-code wiki doctor
```

## CI (optional)

OpenWiki can run on a schedule and open a documentation PR. Copy the upstream examples from the [OpenWiki repository](https://github.com/langchain-ai/openwiki) (for example `examples/openwiki-update.yml`) and provide model credentials as secrets. AX Code does not require CI wiki updates for local use.

## Non-goals

- Replacing `ax-code index` or DRE/impact tools with markdown search
- Shipping OpenWiki inside the AX Code binary
- Guaranteeing every wiki claim is factually perfect (synthesis can drift)
- Auto-running OpenWiki on every session start (too expensive)
