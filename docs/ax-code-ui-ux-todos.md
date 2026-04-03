# AX Code UI/UX TODO Report

Date: 2026-04-03

Scope: current `ax-code` app after the guided session UX batch shipped in `8b1b8e8`. This review only keeps remaining high-value, low to medium risk items that are supported by the current codebase.

## Already Shipped

- Quick-start workflow chips on Home, new session, and empty composer states.
- Project Context dialog for instruction files, cached memory, and starter guides.
- Unified Activity inbox in the project sidebar.
- Visible Recipes entry point, grouped slash menu, recipe favorites, recents, and repo recommendations.
- Sticky review summary strip with filters and next-file actions.
- Permission decision cards and queued batch decisions.
- Permission rule inspector and revoke actions in Project Context.
- Compact session status line above the composer.
- Review handoff card for completed sessions.
- Todo dock next-step planner and followup queue upgrades.

## Findings

- `P2`: Recovery UX for degraded terminal or server state is still too implicit.
  Evidence: [terminal.tsx](/Users/akiralam/code/ax-code/packages/app/src/components/terminal.tsx#L495) retries socket reconnects with backoff, and [server-health.ts](/Users/akiralam/code/ax-code/packages/app/src/utils/server-health.ts) already computes health, but there is no dedicated recovery banner with explicit actions. [session-status-line.tsx](/Users/akiralam/code/ax-code/packages/app/src/pages/session/composer/session-status-line.tsx) shows state chips, but not a focused retry workflow.
  User impact: users can see that something is unhealthy, but they still have to infer whether the app is retrying, whether input is safe, and what action to take next.
  Competitor pattern: good agent shells show a narrow "degraded but recoverable" state instead of jumping straight from healthy to error toast.
  Low-risk shape:
  add a transient recovery banner near the composer or terminal,
  show `Reconnecting`, `Retrying`, or `Connection lost`,
  expose `Retry now`, `Dismiss`, and `Open server picker` when applicable,
  reuse existing health and retry state instead of adding new backend state.
  Likely touch points: [terminal.tsx](/Users/akiralam/code/ax-code/packages/app/src/components/terminal.tsx), [session-status-line.tsx](/Users/akiralam/code/ax-code/packages/app/src/pages/session/composer/session-status-line.tsx), [status-popover.tsx](/Users/akiralam/code/ax-code/packages/app/src/components/status-popover.tsx).

- `P2`: Review handoff still stops one step short of actionable verification.
  Evidence: the handoff card in [session-review-handoff-card.tsx](/Users/akiralam/code/ax-code/packages/app/src/pages/session/session-review-handoff-card.tsx) is useful, but `Run checks` in [session.tsx](/Users/akiralam/code/ax-code/packages/app/src/pages/session.tsx#L1674) only seeds a generic prompt instead of offering repo-aware verification shortcuts.
  User impact: users still need to decide which checks matter after a run, especially in repositories with multiple common validation commands.
  Competitor pattern: stronger completion flows suggest the next verification action, not just a generic follow-up ask.
  Low-risk shape:
  infer common check commands from repo files or remembered user actions,
  show 1-3 suggested checks in the handoff card,
  keep execution opt-in by seeding the composer or queueing a followup draft instead of auto-running commands.
  Likely touch points: [session.tsx](/Users/akiralam/code/ax-code/packages/app/src/pages/session.tsx), [session-review-handoff-card.tsx](/Users/akiralam/code/ax-code/packages/app/src/pages/session/session-review-handoff-card.tsx), [prompt-input.tsx](/Users/akiralam/code/ax-code/packages/app/src/components/prompt-input.tsx).

## Best Next 3

- [ ] `P2`: Add a degraded-state recovery banner for terminal and server issues.
- [ ] `P2`: Add repo-aware verification shortcuts to the review handoff card.
- [ ] `P3`: Tighten recovery and verification copy after runtime testing.

## Why These 3 First

- They reduce the remaining "what do I do now?" gaps after the larger trust and guidance work landed.
- They build directly on state AX Code already tracks.
- They avoid risky runtime changes and stay mostly in app state, copy, and presentation.

## Open Questions

- Verification shortcuts should stay opt-in; auto-running checks would move this into higher-risk territory.
