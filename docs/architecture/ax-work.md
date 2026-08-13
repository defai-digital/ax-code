# AX Work

Desktop computer-use for the existing Work surface. Product and planning docs live under `.internal/` (local-only):

- `.internal/prd/PRD-2026-08-12-ax-work.md`
- `.internal/adr/ADR-052-ax-work-computer-use.md`
- `.internal/spec/SPEC-2026-08-12-ax-work.md`
- `.internal/reports/planning/ax-work/PHASES.md`

Runtime contract (Phase 1) is in `packages/ax-code/src/visual/computer/` and
`packages/ax-code/src/tool/computer/`. Enable with
`AX_CODE_EXPERIMENTAL_COMPUTER_AGENT=1`. Tools fail closed until a native host
is bound (Phase 3+).
