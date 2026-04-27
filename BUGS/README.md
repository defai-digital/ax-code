# Bug Reports

## Status (2026-04-27, full BUGS folder triage)

Last triage and hardening pass: 2026-04-27.  
Outcome: all open bugs in this folder are now closed as fixed or false positives.

### Closed in this pass (fixed)

| ID | Component | Summary |
|----|-----------|---------|
| ui-001 | `scroll-view.tsx` | Thumb drag `pointermove`/`pointerup` listeners are cleaned up on unmount and drag end. |
| ui-002 | `revert-notice.tsx` | Revert message pluralization now matches message count. |
| ui-003 | `dialog-rollback.tsx` | Rollback errors now surface via toast and preserve dialog flow. |
| ui-004 | `layout.ts` | Sidebar width now scales by terminal width with narrow-screen behavior. |
| ui-005 | `session-graph.logic.ts` | Long node labels are wrapped in fixed-width chunks. |
| ui-006 | `overlay/popover.tsx` | Popover close behavior is focus-safe and resets dismiss state deterministically. |
| ui-007 | `footer.tsx` | Welcome prompt is one-shot until reconnect and no longer flashes periodically. |
| ui-008 | `sidebar.tsx` | MCP status branches now use typed status values without string casts. |
| ui-009 | `session-graph.tsx` | Session graph edge path now scales control points by span distance. |
| ui-012 | `message-part.tsx` | Tool error rendering uses typed error-state guard instead of `any` cast. |
| ui-013 | `session-turn.tsx` | Message rendering is callback-driven and avoids non-null assertions. |

### Cleared as false positive

| ID | Component | Reason |
|----|-----------|--------|
| ui-010 | Multiple files | Existing map stores are session-local lifecycle containers with bounded intended lifetime; no reliable leak repro found in code-path review. |
| ui-011 | Multiple files | Reported path operations use `Global.Path.*` base directories and trusted persistence keys; no untrusted sink was identified. |

### Historical status

Prior triage passes are available in git history.
