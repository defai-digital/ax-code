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

Status: Implemented

Scope:

- Audit session tab, active session, project, directory, worktree, and server identity propagation.
- Identify any draft state keyed only by current route or session ID.
- Produce a minimal patch plan for durable tab/draft keys.

Implemented findings:

- `sendMessage` could be called without an active session or open draft, allowing the lower route layer to receive an empty session id. It now fails fast with a store error.
- Inline comment drafts used a global `"draft"` session key for new sessions. Draft comment keys are now scoped by draft directory, falling back to project id when directory is not available.

Acceptance:

- There is a concrete list of unsafe identity keys, or a documented finding that current keys are sufficient.
- Proposed key shape includes server, project, directory, worktree, and session or draft identity where applicable.

Validation:

- `pnpm --dir desktop/packages/ui test -- src/sync/session-ui-store.test.ts src/stores/useInlineCommentDraftStore.test.ts`
- `pnpm --dir desktop/packages/ui type-check`

### Phase 0.3: Durable Desktop Tab Projection

Status: Implemented

Scope:

- Add or refine a window-scoped tab projection only if Phase 0.2 shows gaps.
- Preserve tab target, title, project/directory, branch, status, and last active tab across reload.
- Avoid introducing runtime ownership into Desktop.

Implemented decision:

- A full tab projection is not yet needed for the first durable slice.
- Desktop now persists the last active chat session target as `{ sessionId, directory, updatedAt }` from `session-ui-store`.
- App startup restores that target after global sessions have loaded. It validates existence when the snapshot is ready and avoids clearing the target on transient global session load errors.

Acceptance:

- Reload preserves the user's active Desktop session context.
- Opening a tab cannot accidentally target a different project, server, or worktree.

Validation:

- `pnpm --dir desktop/packages/ui test -- src/sync/session-ui-store.test.ts`
- `pnpm --dir desktop/packages/ui type-check`

### Phase 0.4: Session-Scoped Failure Boundaries

Status: Implemented

Scope:

- Ensure a failed session view cannot blank unrelated Desktop sessions.
- Add focused error boundary coverage around high-risk session panes if missing.

Implemented finding:

- `ChatErrorBoundary` was scoped by `sessionId` in props but did not reset when `sessionId` changed. A render crash in one session could keep the chat pane stuck on the error state after switching sessions.
- The boundary now resets its error state when the active session changes.

Acceptance:

- One failed session pane shows a recoverable error state.
- Other tabs and global navigation remain usable.

Validation:

- `pnpm --dir desktop/packages/ui test -- src/components/chat/ChatErrorBoundary.test.tsx`
- `pnpm --dir desktop/packages/ui type-check`

## Phase 1: Desktop MCP Context Browser

Goal: make MCP resources discoverable and intentionally insertable from Desktop.

### Phase 1.1: Formal MCP Resource Contract

Status: Implemented

Scope:

- Promote MCP resource listing from experimental-only API to formal `/mcp/resources`.
- Add formal resource read API at `/mcp/:name/resource?uri=...`.
- Add Desktop MCP store cache/read helpers against the formal route.
- Keep UI browser work for the next phase so the contract can be tested independently.

Implemented finding:

- Desktop could only depend on the experimental resource listing route, and there was no formal read route for a selected resource. This made Phase 1 browser work depend on unstable API shape.

Validation:

- `pnpm --dir packages/ax-code exec vitest run test/server/route-validation.test.ts`
- `pnpm --dir desktop/packages/ui test -- src/stores/useMcpStore.test.ts`
- `pnpm --dir packages/ax-code typecheck`
- `pnpm --dir desktop/packages/ui type-check`
- `pnpm --dir packages/sdk/js run build`
- `pnpm --dir packages/sdk/js exec tsc --build --force`
- `pnpm run check:openapi`

### Phase 1.2: Desktop MCP Resource Browser

Status: Implemented

Scope:

- Add a Desktop MCP resource browser to the selected server settings page.
- Show resources from the formal MCP resource contract, scoped to the selected server.
- Support manual refresh, resource preview, copy URI, and copy text for text resources.
- Keep composer insertion for a later slice to avoid mixing browsing UX with message composition contracts.

Implemented finding:

- After Phase 1.1, Desktop had a stable resource API but no user-facing way to inspect resources. The first UI slice now makes resources visible without invoking an agent tool call.

Validation:

- `pnpm --dir desktop/packages/ui test -- src/components/sections/mcp/McpResourceBrowser.test.ts src/stores/useMcpStore.test.ts`
- `pnpm --dir desktop/packages/ui type-check`

### Phase 1.3: MCP Resource Composer References

Status: Implemented

Scope:

- Add selected MCP resources to the Desktop composer as visible attachments.
- Preserve `source: { type: "resource", clientName, uri }` through Desktop send routing.
- Let the runtime resolve resource contents through the existing MCP permission/read path.

Implemented finding:

- Desktop attachments previously modeled only local/server files, so MCP resource references would be flattened into normal file URLs and lose the runtime resource source metadata.

Validation:

- `pnpm --dir desktop/packages/ui test -- src/sync/input-store.test.ts src/sync/session-ui-store.test.ts src/components/sections/mcp/McpResourceBrowser.test.ts src/stores/useMcpStore.test.ts`
- `pnpm --dir desktop/packages/ui type-check`

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

### Phase 2.1: Rollback Directory Safety And Points Contract

Status: Implemented

Scope:

- Fix Desktop revert/unrevert/refetch/fork actions to use the target session directory instead of the current global directory.
- Preserve MCP resource attachments when a reverted or forked prompt is restored into the composer.
- Add a Desktop rollback points store over the existing generated SDK `session.rollbackPoints` contract.
- Keep visual rollback preview/apply UI for the next slice.

Implemented finding:

- `revertToMessage`, `unrevertSession`, `refetchSessionMessages`, and `forkFromMessage` could route through the active Desktop directory rather than the session's owning directory. In multi-project or worktree usage, this could call the wrong runtime instance or mutate the wrong child store.

Validation:

- `pnpm --dir desktop/packages/ui test -- src/sync/session-actions.test.ts src/stores/useSessionRollbackStore.test.ts`
- `pnpm --dir desktop/packages/ui type-check`

### Phase 2.2: Timeline Rollback Points Visibility

Status: Implemented

Scope:

- Show rollback points in the Desktop conversation timeline as a compact read-only strip.
- Include rollback step, tool/kind labels, token counts, duration, refresh, loading, and error states.
- Use the Phase 2.1 rollback points store and session directory scoping.
- Do not expose apply rollback yet; file-impact diff preview and confirmation remain required before write-affecting actions.

Validation:

- `pnpm --dir desktop/packages/ui test -- src/components/chat/TimelineDialog.test.ts src/stores/useSessionRollbackStore.test.ts`
- `pnpm --dir desktop/packages/ui type-check`

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
