# Agentic Coding Task Supervision

Internal planning for making AX Code’s **already-built** task/subagent/workflow stack feel like a daily-driver agentic coding CLI — competitive with Codex, Grok Build, and OpenCode on supervision, without becoming OpenClaw (an Agent OS).

> This directory is gitignored (see root `.gitignore` → `.internal/`). Code and tests that implement the program live under `packages/ax-code/` and **are** committed.

## Documents

| Doc | Purpose |
|-----|---------|
| [PRD](../../../prd/PRD-2026-08-14-agentic-coding-task-supervision.md) | Product requirements, competitive framing |
| [ADR-055](../../../adr/ADR-055-agentic-coding-task-supervision.md) | Durable decisions (ledger, background, push, cancel) |
| [SPEC](../../../spec/SPEC-2026-08-14-agentic-coding-task-supervision.md) | Seams, contracts, file map |
| [PHASES.md](./PHASES.md) | Multi-phase plan + exit criteria |
| [STATUS.md](./STATUS.md) | Live status and verify commands |

## North-star thesis

> AX Code is an open, multi-provider **agentic coding CLI**: spawn specialists, keep the parent usable, prove results, and supervise every detached run on one ledger.

## Related

- ADR-048 / `.internal/reports/planning/agentic-runtime/` — harness integrity (done)
- ADR-054 / TUI Revamp 2 — future Ratatui rail will consume the same ledger
- `docs/guides/autonomous.md`, `docs/guides/long-running-operations.md`
