# Implementation Plan: Desktop-First OpenCode Learnings

Date: 2026-07-07
Status: In Progress
Related:

- `ax-internal/prd/desktop-first-opencode-learnings-prd.md`
- `ax-internal/adr/ADR-048-desktop-first-agent-experience.md`
- `ax-internal/architecture/desktop-first-opencode-learnings-tech-spec.md`

## Non-Goals

- Do not add new TUI UX features for these learnings.
- Do not duplicate runtime execution, storage, provider, permission, or MCP logic inside Desktop.
- Do not introduce monetary cost tracking or pricing surfaces.

## Delivery Strategy

Ship in small Desktop-first phases. Each phase must preserve the runtime as the source of truth and use typed API/SDK/sync contracts where cross-package boundaries are involved.

## Phase 0: Desktop Session Reliability

Goal: make background and multi-session Desktop usage dependable before adding larger workflow features.

### Phase 0.1: Blocking Input Visibility

Status: Implemented

Scope:

- Treat pending questions as blocking session input, matching pending permission visibility.
- Apply the same badge logic in the session switcher and sidebar.
- Keep the existing badge state name for now to avoid broad visual/i18n churn.

Acceptance:

- A background session with a pending question shows the same attention badge as a session waiting for permission.
- Permission precedence remains unchanged.
- Running, error, dirty, and unread states still keep their existing priority order when no blocking input exists.

Validation:

- `pnpm --dir desktop/packages/ui test -- src/hooks/useSessionBadgeState.test.ts`
- `pnpm --dir desktop/packages/ui type-check`

### Phase 0.2: Tab And Draft Identity Audit

Status: Planned

Scope:

- Audit session tab, active session, project, directory, worktree, and server identity propagation.
- Identify any draft state keyed only by current route or session ID.
- Produce a minimal patch plan for durable tab/draft keys.

Acceptance:

- There is a concrete list of unsafe identity keys, or a documented finding that current keys are sufficient.
- Proposed key shape includes server, project, directory, worktree, and session or draft identity where applicable.

### Phase 0.3: Durable Desktop Tab Projection

Status: Planned

Scope:

- Add or refine a window-scoped tab projection only if Phase 0.2 shows gaps.
- Preserve tab target, title, project/directory, branch, status, and last active tab across reload.
- Avoid introducing runtime ownership into Desktop.

Acceptance:

- Reload preserves the user's active Desktop session context.
- Opening a tab cannot accidentally target a different project, server, or worktree.

### Phase 0.4: Session-Scoped Failure Boundaries

Status: Planned

Scope:

- Ensure a failed session view cannot blank unrelated Desktop sessions.
- Add focused error boundary coverage around high-risk session panes if missing.

Acceptance:

- One failed session pane shows a recoverable error state.
- Other tabs and global navigation remain usable.

## Phase 1: Desktop MCP Context Browser

Goal: make MCP resources discoverable and intentionally insertable from Desktop.

Scope:

- Inventory existing MCP server/resource/template endpoints and SDK coverage.
- Add typed Desktop-facing contracts only for gaps.
- Build a Desktop MCP browser for server state, resources, templates, preview, and errors.
- Add composer references for explicit MCP resource inclusion.

Acceptance:

- Users can browse MCP resources without invoking an agent tool call.
- Users can insert visible MCP references into the composer.
- MCP reads honor trust, auth, timeout, permission, isolation, and context limits.

## Phase 2: Desktop Rollback And Session Move

Goal: expose high-value runtime primitives through safe Desktop workflows.

Scope:

- Add rollback point listing, preview, confirmation, apply, and recovery UI.
- Add session move target picker and validation.
- Prefer existing snapshot/replay/worktree/session APIs before adding routes.

Acceptance:

- Users can preview rollback file/message impact before applying it.
- Session move cannot silently target the wrong directory or worktree.
- Failure states are recoverable and explicit.

## Phase 3: Confined MCP Code Mode Prototype

Goal: evaluate OpenCode-style programmable MCP orchestration without weakening AX Code isolation.

Scope:

- ADR and feature-flagged prototype only.
- Restricted runtime without raw filesystem, network, process, shell, or credential access.
- All side effects flow through existing tool/MCP permission paths.
- Audit every child operation.

Acceptance:

- The prototype can be enabled only by explicit feature flag.
- Replay/audit can reconstruct the orchestration at child-operation level.
- Security review signs off before any default exposure.

## Phase Gates

- Phase 0 must complete before building new Desktop MCP UX.
- Phase 1 must complete before considering confined MCP code mode.
- Phase 2 can run in parallel with Phase 1 only if it does not require shared API contract churn.
- Phase 3 must not start until ADR review confirms the sandbox and audit model.

