# ADR-041: Build a Native Desktop Visual Canvas Instead of Vendoring Cowart

## Status

Proposed

## Date

2026-06-28

## Deciders

ax-code maintainers

## Related

- `ax-internal/prd/PRD-2026-06-28-desktop-visual-canvas.md`
- `ax-internal/tech-spec/TECH-SPEC-2026-06-28-desktop-visual-canvas.md`
- ADR-018: App Headless SDK Boundary
- ADR-020: MCP Security Trust Boundary
- ADR-021: HTML Dev Browser Boundary
- ADR-029: Agent Workflow Skill Productization Boundary
- ADR-035: Lean TUI and Desktop Dashboard Boundary
- ADR-037: AX Code Desktop Monorepo Migration
- ADR-038: Desktop Runtime Transport Optimization
- ADR-039: Desktop First-Value and Parallel-Agent Supervision

## Context

Cowart demonstrates a useful workflow: a local infinite canvas for Codex with AI image holders, annotations, generated image insertion, and project-local persistence. The workflow belongs naturally in AX Code Desktop because Desktop is the product surface that can host visual planning, browser previews, screenshots, and agent supervision.

Cowart's implementation is not a suitable direct dependency for AX Code Desktop. Its backend behavior lives in Vite config, lifecycle depends on shell scripts that implicitly install dependencies, persistence is ad hoc, MCP tools mutate tldraw snapshots directly, and UI copy is not aligned to Desktop's English/i18n policy. There is also no reason to couple AX Code Desktop's long-term product surface to a third-party plugin's file format or service lifecycle.

The architectural question is whether to:

1. Install and embed Cowart as-is.
2. Fork and heavily rework Cowart.
3. Build an AX-owned canvas contract and use Cowart only as product reference.

## Decision

AX Code will build a native Desktop visual canvas and will not vendor Cowart source code.

The first implementation will be intentionally narrow:

- Project-local storage under `.ax-code/canvas/`.
- A versioned AX-owned canvas document format.
- Desktop web server routes for load/save.
- A Canvas mode inside the existing context panel.
- Basic notes, image placeholders, positioning, and persistence.

Cowart remains a workflow reference for future milestones such as AI image slot fill, annotation-driven edits, and MCP/tool insertion. Those workflows must be implemented through AX-owned API, permission, asset, and session boundaries.

## Policy

### Ownership Policy

- AX Code owns the canvas storage format, lifecycle, API, and Desktop UI.
- Cowart source code, shell scripts, and tldraw snapshot mutation logic must not be vendored.
- Third-party canvas engines may be evaluated later, but only behind the AX-owned document/API contract.

### Product Policy

- New feature code and copy are English by default.
- The canvas is an agent-context surface, not a general-purpose design suite.
- Desktop owns the visual surface; CLI/TUI remain session-first and do not host the canvas UI.

### Boundary Policy

- UI code reads/writes canvas documents only through Desktop web server routes.
- Project paths are resolved through existing Desktop project-directory validation.
- Generated image insertion and annotation workflows must use explicit APIs/tools, not direct snapshot mutation from arbitrary plugins.
- MCP integration is allowed only through ADR-020 trust and permission boundaries.

## Consequences

### Positive

- The feature fits Desktop natively and avoids external service/plugin lifecycle drift.
- The storage format can be versioned and migrated by AX Code.
- Permission and path rules can use existing Desktop route guardrails.
- The UX can match Desktop theme, layout, and English copy from day one.
- Future image-generation workflows can be integrated with existing attachments/session flows instead of plugin-specific conventions.

### Negative / Costs

- The first MVP is less capable than Cowart's tldraw prototype.
- AX Code must own canvas editing, storage migrations, and tests.
- A later rich-canvas engine integration will require migration work.

## Alternatives Considered

### Install Cowart as a Desktop-managed plugin

Rejected as the main product path. It is useful as a short-term manual workaround, but it leaves lifecycle, storage, UI consistency, and support outside AX Code's control.

### Fork Cowart and patch it into Desktop

Rejected. A fork inherits the weakest parts of the implementation while creating a long-term merge and attribution burden. A clean AX implementation is smaller and clearer.

### Adopt tldraw immediately

Deferred. tldraw may be the right rich engine later, but the first slice needs an AX-owned contract before adding a large UI dependency and snapshot format.

### Do nothing

Rejected. Visual planning and annotation workflows are a real product gap for Desktop, and Cowart validates demand for the category.

## Acceptance Criteria

- A native Canvas context-panel mode exists in Desktop.
- Canvas state persists per project under `.ax-code/canvas/main.canvas.json`.
- The canvas document has an explicit version and validation.
- Focused tests cover the storage/API contract.
- No Cowart source code is copied into the repository.
- User-facing feature copy is English.
