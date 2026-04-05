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
- Recovery banners for degraded server/session state and terminal disconnects.
- Review handoff card with repo-aware and remembered verification shortcuts.
- Broader manifest-based verification inference beyond `package.json` scripts.
- Todo dock next-step planner and followup queue upgrades.

## Best Next 3

- [ ] `P3`: Tighten recovery and verification copy after runtime testing.
- [ ] `P3`: Add edit/manage controls for remembered verification commands if usage data shows churn.
- [ ] `P3`: Add safer verification inference for Python and other less-structured repos if needed.

## Why These 3 First

- They reduce the remaining "what do I do now?" gaps after the larger trust and guidance work landed.
- They build directly on state AX Code already tracks.
- They avoid risky runtime changes and stay mostly in app state, copy, and presentation.

## Open Questions

- Verification shortcuts should stay opt-in; auto-running checks would move this into higher-risk territory.
