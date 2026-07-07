# Technical Spec: Desktop-First Agent Experience Improvements

Date: 2026-07-07
Status: Draft
Related: `ax-internal/prd/desktop-first-opencode-learnings-prd.md`, `ax-internal/adr/ADR-048-desktop-first-agent-experience.md`

## Objective

Implement the high-value OpenCode learnings as Desktop-first AX Code capabilities:

- Reliable multi-session Desktop state.
- MCP resource/context browser and composer references.
- Desktop rollback and session move flows over existing runtime primitives.
- Public API/SDK contracts for Desktop workflows.
- A gated design path for confined MCP code mode.

## Architecture Principles

- Desktop owns UX; runtime owns execution, storage, permissions, isolation, and provider behavior.
- Server/SDK contracts are the integration boundary between Desktop and runtime.
- Session, project, and worktree identity must be explicit in every stateful Desktop action.
- MCP resources are context inputs and must be governed like other context/tool access.
- Rollback/move UI must use existing snapshot, replay, worktree, and session APIs.
- TUI is not a target for new UX work.

## Existing Repo Touchpoints

- Desktop UI: `desktop/packages/ui`
- Desktop web/API bridge: `desktop/packages/web`
- Electron shell and window state: `desktop/packages/electron`
- Main runtime: `packages/ax-code/src`
- SDK/OpenAPI: `packages/sdk/js`
- Session runtime: `packages/ax-code/src/session`
- Worktrees: `packages/ax-code/src/worktree`
- Snapshots: `packages/ax-code/src/snapshot`
- Replay/audit: `packages/ax-code/src/replay`, `packages/ax-code/src/audit`
- MCP: `packages/ax-code/src/mcp`
- Permission/isolation: `packages/ax-code/src/permission`, `packages/ax-code/src/isolation`

## Phase 0: Desktop Session Reliability

### Data Model

Desktop should maintain a window-scoped tab projection. Each tab record should include:

- `tabID`
- `serverID` or normalized server URL
- `sessionID`
- `projectID`
- `directory`
- `worktree`
- `branch`
- `title`
- `status`
- `attention`
- `lastActiveAt`
- `draftKey`

Draft state should be keyed by:

- server
- project
- directory
- worktree
- session or draft tab identity

Do not key drafts only by session ID or current route. That allows wrong-target reuse when users switch projects, worktrees, or servers.

### UI Changes

Add or refine Desktop UI primitives:

- Session tab strip with durable title/path/server labels.
- Attention badge for pending questions and permissions.
- Recently closed tabs/projects list.
- Session-scoped error boundary.
- Mounted-state preservation for review and terminal panes where practical.

### Runtime/Event Inputs

Desktop should consume typed live events for:

- session status changes
- message updates
- question asked/replied/rejected
- permission requested/replied
- server/project availability changes
- session deletion/archive

### Acceptance Criteria

- Reloading Desktop preserves tab title, session target, server, project, branch, and last active tab.
- A pending question in a background tab is visible without opening the tab.
- A failed session page does not crash or blank unrelated tabs.
- Draft prompts do not appear in the wrong project/server/worktree.
- Switching tabs does not reset review scroll state or terminal content unless the underlying session is closed.

## Phase 1: Desktop MCP Context Browser

### Capability Model

The Desktop MCP browser should show:

- Configured servers.
- Runtime connection/auth/trust state.
- Prompts/resources/resource templates when supported.
- Resource preview with truncation and content type.
- Last error and recommended next action.

### API/SDK Needs

Prefer typed V2 contracts for:

- list MCP servers and status
- list resource templates by server
- list resources by server
- read resource by URI/template args
- expose resource content type, size, truncation, and source metadata
- surface auth/trust/timeout/schema errors in structured form

If equivalent endpoints already exist, use them and close SDK gaps rather than adding parallel routes.

### Composer Integration

Add a Desktop composer context picker that can insert MCP resource references. Reference records should preserve:

- server name
- resource URI or template ID
- template args
- display label
- content snapshot policy

The runtime should resolve references during prompt assembly through existing permission and MCP access paths.

### Safety

- MCP resource reads must honor server trust, configured timeouts, permission rules, and isolation.
- Large resources must be bounded by preview limits and prompt-context limits.
- Resource output should not be silently injected into prompts without visible user intent.
- Resource errors should be visible and recoverable.

### Acceptance Criteria

- Users can browse MCP resources from Desktop without invoking a hidden agent tool call.
- Users can add an MCP resource reference to a prompt and see what will be included.
- Disabled, unauthorized, untrusted, timed-out, or broken MCP servers show actionable state.
- MCP resource reads do not bypass permission/isolation checks.

## Phase 2: Desktop Rollback And Session Move UX

### Rollback UX

Use existing rollback/snapshot/replay capabilities. Desktop should expose:

- Rollback points grouped by message/tool step.
- Affected file list.
- Diff preview before applying rollback.
- Confirmation for file-affecting rollback.
- Result state after rollback, including reverted messages and file status.

### Session Move UX

Use existing project, worktree, and session metadata primitives. Desktop should expose:

- Target project/directory/worktree picker.
- Branch and dirty-state context.
- Validation before move.
- Clear post-move notice in the session timeline or header.

### API/SDK Needs

Prefer typed contracts for:

- list rollback points
- preview rollback effects
- apply rollback/revert
- list valid session move targets
- move session
- fetch current session location metadata

### Acceptance Criteria

- Users can see what rollback will change before applying it.
- Rollback failures leave the UI in a known recoverable state.
- Moving a session cannot silently target the wrong directory or worktree.
- After move, the session makes the new working directory explicit.

## Phase 3: Confined MCP Code Mode Prototype

### Scope

This is not a default feature. It should start as an ADR/prototype behind a feature flag.

### Execution Model

The prototype may allow a restricted script to orchestrate approved MCP/tool calls. It must not provide direct access to:

- arbitrary filesystem APIs
- arbitrary network APIs
- process spawning
- shell execution
- raw credentials

All side effects must flow through existing tool/MCP permission paths.

### Auditability

Each child operation must record:

- parent script ID
- child tool or MCP call name
- args summary with sensitive data redacted
- permission decision
- status
- duration
- output summary or error

Replay/audit records should be sufficient to reconstruct the orchestration without rerunning the LLM.

### Desktop UX

Desktop should show:

- script source or generated plan
- child calls
- permission gates
- progress
- failures
- final result

### Exit Criteria For Broader Rollout

- Security review passes.
- Permission denial behavior is deterministic.
- Replay/audit coverage is complete enough for incident review.
- Isolation tests cover read-only, workspace-write, and full-access modes.
- Desktop can explain what happened without raw logs.

## API And SDK Contract Strategy

When adding or changing server endpoints:

- Define schemas with Zod in runtime route code.
- Regenerate OpenAPI and SDK snapshots.
- Avoid Desktop-only private endpoints unless they are purely Desktop server concerns.
- Include structured error types for user-actionable Desktop messages.
- Preserve compatibility for existing headless consumers.

## Testing Plan

### Unit Tests

- Draft key generation and target scoping.
- Attention badge derivation from question/permission events.
- MCP resource reference serialization.
- Rollback preview formatting.
- Session move target validation.

### Integration Tests

- Desktop store updates from live session events.
- MCP resource read with auth needed, disabled server, timeout, and success.
- Rollback preview and apply with file changes.
- Session move across worktree/project targets.
- SDK/OpenAPI contract tests for new endpoints.

### Regression Tests

- No monetary pricing/spend surfaces are introduced.
- Isolation modes still remove or restrict tools correctly.
- Permission denial does not continue hidden side effects.
- Existing TUI attach/run compatibility remains intact.

## Rollout Flags

Suggested feature flags:

- `AX_CODE_DESKTOP_SESSION_TABS_V2`
- `AX_CODE_DESKTOP_MCP_CONTEXT_BROWSER`
- `AX_CODE_DESKTOP_ROLLBACK_FLOW`
- `AX_CODE_EXPERIMENTAL_MCP_CODE_MODE`

Names can be adjusted to match existing flag conventions before implementation.

## Migration Notes

- Existing Desktop tab/draft stores may need one-time normalization to include server/project/worktree identity.
- Keep old state readable for at least one release cycle.
- If a stored tab target cannot be resolved, keep a recoverable placeholder tab instead of dropping it silently.

## Open Questions

- Should MCP resource references store content snapshots for reproducibility, or always resolve live content?
- Should rollback preview be required for all file-affecting rollback operations?
- Should recently closed tabs be window-local, server-local, or global?
- Which Desktop surface should own MCP context: composer popover, right sidebar, or a dedicated settings/context page?
