# AX Work

AX Work is a **separate product** (`~/code/ax-work`), not a tab inside AX
Code Desktop. Combining office Work with coding tools in one app is
rejected (ADR-053).

Planning docs live under `.internal/` (local-only):

- `.internal/prd/PRD-2026-08-12-ax-work-split.md`
- `.internal/adr/ADR-053-ax-work-product-split.md`
- `.internal/spec/SPEC-2026-08-12-ax-work-split.md`
- `.internal/reports/planning/ax-work/PHASES.md`
- `.internal/reports/planning/ax-work/SPLIT-REVIEW.md`

AX Code Desktop is Code-only (Track A complete). The Phase 1 computer
contract was copied into `~/code/ax-work` and deleted from this repo
(Track A3). AX Code keeps vision (see-only), agentic coding, CLI/TUI,
and session-scoped `browser_*`.

Legacy `metadata.work` / `agent: "work"` sessions stay readable with
send disabled. They are not auto-mapped to `build`.
