# Bug Reports

## Status (2026-04-27, third pass)

Last triage scan: 2026-04-27 (IO/file read-write focused scan, third pass).

### Active Bugs

None.

### Resolved in this pass (2026-04-27, sidebar pass)

Eight sidebar findings were fixed or reclassified:

- **sidebar-001** (Medium) — `prompt/index.tsx` prompt width now consumes
  the session-level sidebar visibility signal.
- **sidebar-002** (Low-Medium) — `sidebar.tsx` MCP color lookup now has explicit
  safe fallback for unknown statuses.
- **sidebar-003** (Low) — `sidebar.tsx` validates `session_status` shape before
  casting it into `FooterSessionStatus`.
- **sidebar-004** (Low-Medium) — `sidebar.tsx` retry label now reuses
  `footerSessionStatusView`, including countdown text.
- **sidebar-005** (Low) — `sidebar.tsx` timer effect now tracks only
  `status().type`, avoiding timer churn on busy-step transitions.
- **sidebar-006** (Medium) — `quality.ts` now treats `overallStatus: "fail"` as
  user-actionable in sidebar quality filtering.
- **sidebar-007** (Low-Medium) — `sidebar.tsx` Todo header now shows remaining
  item count when collapsed.
- **sidebar-008** (Low) — `sidebar.tsx` `qualityColor` now falls back to muted
  for unknown/missing readiness status.

### Closed / False Positives (this pass)

- **No additional bug IDs** were processed in this pass.

### Historical Status

Earlier passes (sidebar-001 through sidebar-008 and prior triage cycles) are cleared
and not re-listed here. See git history for resolution details.
