# Web Dashboard

Status: Active  
Scope: current-state  
Last reviewed: 2026-08-18  
Owner: ax-code runtime

AX Code serves a local web dashboard from its built-in HTTP server. Open it from the TUI sidebar (**Analysis → dashboard**, opens the current session's report), from the command palette with `session.dre.web`, or from the CLI with `ax-code dre-graph [--index] [--open]`. AX Code Desktop embeds the same pages.

## Workspace Dashboard (`/dre-graph`)

The workspace overview for the current project, covering the last 30 days:

- **Usage** — sessions, messages, total tokens, and cache share (cache-read tokens as a share of all input reads; a higher share means less re-reading).
- **Activity** — tokens per day for the last 14 days; hover a bar for the exact day, token, and session counts.
- **Model usage** — top models by tokens with message counts.
- **Tool usage** — top tools by call count.
- **Session health** — average risk, readiness breakdown, and validation pass rate across recent sessions.
- **Sessions** — recent sessions with token, risk, and readiness chips; **View →** opens the per-session report.

## Session Report (`/dre-graph/session/<id>`)

A per-session drill-down, ordered so the sections every session has data for come first:

1. **Usage** — input/output/reasoning/cache tokens, cache share, duration, and per-model breakdown.
2. **Summary** — what the agent decided and did, with step/tool/error counts.
3. **Changes** — per-file change table with risk and diff stats.
4. **Timeline** — execution Gantt chart (expand to render).
5. **Activity** — slowest steps, tool timings, agents involved, and rollback points.
6. **Trust sections** (Verdict, Risk, Validation, Branches) render only when the session has substance for them — a chat-only or trivially small session does not render an empty 0/100 gauge or scorecard. Validation appears only when validation commands were recorded; Branches only when the session has sibling branches to compare.

## Data sources

All numbers come from the local SQLite store: sessions and message token counts, the per-session event log (steps, tools, durations, errors), and DRE risk assessment. No pricing data is bundled with model catalogs, so the dashboard reports tokens and cache efficiency rather than estimated cost. Pages live-update via server-sent events and reload on relevant session changes.

## Related

- `ax-code stats` — terminal token usage report with `--days`, `--models`, and `--tools` filters.
- [Supported Providers and Models](../providers/supported-providers.md) — connecting providers whose models appear in the usage breakdowns.
