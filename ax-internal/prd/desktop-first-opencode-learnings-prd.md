# PRD: Desktop-First Agent Experience Improvements From OpenCode Learnings

Date: 2026-07-07
Status: Draft
Owner: Product / Desktop

## Summary

OpenCode shipped 43 releases between 2026-05-07 and 2026-07-07. The highest-value signals are not TUI features by themselves; they are product needs around reliable multi-session work, visible MCP context, safe session rollback/move flows, and clean runtime APIs.

AX Code should apply those learnings through a Desktop-first strategy. The TUI should stay compatible and reliable, but new product UX should default to AX Code Desktop.

## Problem

AX Code already has strong runtime primitives: sessions, worktrees, snapshots, rollback, replay, MCP, permissions, SDK, and Desktop. The gap is that several high-value flows are not yet presented as a coherent Desktop experience:

- Users can run multiple sessions but can still lose orientation across tabs, projects, servers, worktrees, pending questions, and terminal/review state.
- MCP is available as tool capability, but resources and server context are not yet a first-class Desktop context surface.
- Rollback, snapshots, replay, and worktree movement exist mostly as runtime capabilities; users need safer visual flows to inspect and act.
- TUI improvements should not become the primary product direction because the desired user path is Desktop.

## Goals

- Make Desktop the best place to manage multi-session, multi-workspace agent work.
- Improve trust by preserving session state across tab switches, reloads, and server/project changes.
- Make MCP resources discoverable, previewable, and permission-aware in Desktop.
- Productize existing rollback/move primitives through clear Desktop workflows.
- Keep headless API/SDK contracts strong enough that Desktop does not depend on private runtime internals.

## Non-Goals

- Do not add new TUI product UX beyond compatibility, crash fixes, and basic attach/run workflows.
- Do not add monetary pricing or spend surfaces. Token usage and budgets are allowed; dollar-denominated display is not.
- Do not chase provider count as a primary roadmap goal.
- Do not expose arbitrary script execution as a default feature.
- Do not reimplement existing snapshot, replay, rollback, or worktree primitives.

## Target Users

- Engineers running multiple agent sessions across a repository, worktree, or project.
- Desktop users who need to monitor long-running sessions, questions, permissions, terminals, and diffs.
- Teams connecting internal systems through MCP servers.
- Advanced users who need safe rollback or session movement without dropping context.

## User Needs

1. As a Desktop user, I need tabs to preserve session identity, title, project, server, branch, pending state, and draft prompts so I can switch work without losing context.
2. As a Desktop user, I need pending questions and permission requests to be visible from tabs and sidebars so I know which session needs attention.
3. As an MCP user, I need to browse and reference MCP resources from the composer/context UI so I can intentionally include external context.
4. As an MCP user, I need server auth, trust, timeout, and resource errors to be clear so I can fix setup issues without reading logs.
5. As a reviewer, I need rollback points with affected files and diff previews so I can safely undo a session step.
6. As a multi-workspace user, I need to move a session or start a session in a worktree with explicit target, branch, dirty-state, and path context.

## Requirements

### P0: Desktop Session Reliability

- Persist session tabs per Desktop window and server.
- Preserve tab title, session ID, project path, server URL, branch/worktree, and busy/attention state across reloads.
- Keep prompt drafts scoped to the exact target: project, server, directory, worktree, and draft/session identity.
- Show unread attention state for pending questions and permission requests in tabs, sidebars, and session lists.
- Scope session page failures to the affected tab instead of breaking the full app shell.
- Keep review panes and terminal panes from losing useful state when switching tabs.
- Add recently closed tabs/projects where supported by existing Desktop state boundaries.

### P1: Desktop MCP Context Browser

- Add a Desktop MCP resources surface with server list, connection state, auth/trust state, resource templates, and resource previews.
- Support composer references to MCP resources through autocomplete.
- Show resource source, server, size/truncation status, content type, and last-read status.
- Respect MCP permissions, isolation, server trust, and request timeouts.
- Provide actionable errors for auth, disabled server, timeout, invalid schema, large output, and unavailable resources.
- Do not let MCP resources bypass file/network permission boundaries.

### P2: Desktop Rollback And Session Move UX

- Show rollback points on the session timeline or review surface.
- For each rollback point, show message/tool context, affected files, and a before/after diff preview when available.
- Require confirmation before file-affecting rollback.
- Use existing snapshot/revert/replay/session APIs rather than new storage primitives.
- Add a Desktop move/session-target flow that displays project, worktree, directory, branch, dirty-state, and target path.
- After moving a session, show an explicit working-directory change notice in the session context.

### P3: Confined MCP Code Mode Exploration

- Produce an ADR and prototype only; do not make this a default user-facing feature.
- Run behind an explicit feature flag.
- Allow orchestration only through approved MCP/tools.
- Do not grant arbitrary filesystem, network, process, or shell access.
- Record each child operation in replay/audit events.
- Stop or clearly degrade after permission denial.
- Display script, child calls, permission gates, outputs, and failures in Desktop before broader rollout.

### P4: API/SDK Parity

- Ensure Desktop capabilities use public server/SDK contracts.
- Prefer typed V2 endpoints for active sessions, durable session history, questions, permissions, rollback points, session move, MCP resources, and session metadata.
- Keep generated SDK/OpenAPI snapshots in sync when server contracts change.

## Success Metrics

- Fewer user-reported lost-draft, wrong-project, wrong-server, or wrong-session incidents.
- Higher Desktop session retention for users with two or more concurrent sessions.
- Reduced time to resolve MCP auth/resource errors.
- Increased usage of Desktop rollback/move flows without increased support incidents.
- No regressions in `check:no-cost`, isolation behavior, or permission enforcement.

## Rollout

1. Ship P0 behind normal Desktop release flow with focused regression tests.
2. Ship P1 MCP browser behind a Desktop feature flag until auth/resource edge cases stabilize.
3. Ship P2 rollback/move UX with dry-run previews before file-affecting actions are enabled.
4. Keep P3 confined code mode as internal dogfood until security, replay, and permission semantics are reviewed.

## Risks

- State scoping bugs can send prompts or drafts to the wrong server/project.
- MCP resource previews can become slow or noisy without pagination, truncation, and timeout discipline.
- Rollback UX can create false confidence if affected files are incomplete or stale.
- Code mode can become an unsafe execute layer if it bypasses existing permission/isolation paths.

## Open Questions

- Which Desktop tab model is authoritative: server-owned session state, local window state, or a merged projection?
- Should MCP resource references be persisted as resource URIs, content snapshots, or both?
- Which rollback point types should be exposed first: message-level, tool-level, or snapshot-level?
- Should recently closed tabs/projects be local-only or sync across Desktop windows?
