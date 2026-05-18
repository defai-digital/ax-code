# ADR-011: Make TUI Session Tool Rendering a Named Boundary

## Status

Accepted - initial helper extraction implemented by `.internal/prd/PRD-2026-05-18-hotspot-boundary-hardening.md`

## Date

2026-05-18

## Deciders

To be filled by team

## Related

- `.internal/prd/PRD-2026-05-18-hotspot-boundary-hardening.md`
- `.internal/adr/ADR-009-package-organization-boundary-hardening.md`
- `packages/ax-code/src/cli/cmd/tui/routes/session/index.tsx`
- `packages/ax-code/src/cli/cmd/tui/routes/session/tool-rendering.ts`
- `packages/ax-code/test/cli/tui-session-tool-rendering.test.ts`

## Context

`packages/ax-code/src/cli/cmd/tui/routes/session/index.tsx` remains one of the largest and most fragile runtime UI files. It owns route state, synchronization recovery, message composition, message part rendering, and every tool-specific renderer used in the transcript.

The most immediate maintenance risk is the tool-rendering area:

- Tool dispatch is embedded directly in a long JSX `Switch`.
- Coalesced tool labels are computed inside the coalesced renderer component.
- Adding a tool requires editing the large session route file and understanding fallback behavior.
- Tests primarily cover broader session view-model behavior and render anti-patterns, not the pure dispatch contract for tool rendering.

ADR-009 already decided that the repository should reduce large interface-heavy surfaces through package-internal boundary hardening before broad package splitting. This ADR narrows that decision for the TUI session tool renderer.

## Decision

Make TUI session tool rendering a named boundary with pure helper contracts.

The route component may continue to own the actual JSX renderer components for now, but dispatch policy and coalesced-label policy should live in a renderer-free module:

- `sessionToolRendererKey(tool)` maps a tool name to a known renderer key or `generic`.
- `isKnownSessionToolRenderer(tool)` exposes whether a tool has a specialized renderer.
- `coalescedToolLabel(tool, count)` owns the collapsed group label text.

The route should dispatch through a registry keyed by `SessionToolRendererKey` rather than a long inline `Switch` of tool names.

## Policy

- Tool renderer selection must be a pure, testable contract.
- Unknown tools must continue to fall back to the generic renderer.
- Coalesced labels must remain stable and covered by unit tests.
- The first slice should not move every tool JSX component out of `index.tsx`; that would create too much churn at once.
- Future slices may move renderer components into `tool-renderers/` only after the dispatch contract is stable.

## Consequences

### Positive

- Adding a new specialized tool renderer requires updating one registry and one helper test.
- Unknown-tool fallback is explicit and testable.
- Coalesced group labels can be changed without mounting the TUI.
- The large session route starts moving toward named seams without broad UI churn.

### Negative / Costs

- `index.tsx` remains large after the first slice.
- The renderer JSX functions are still colocated with the route until later phases.
- A registry indirection adds one more symbol to follow during debugging.

## Alternatives Considered

### Move All Tool Renderers Immediately

Moving every renderer component into a new folder would reduce the route file size faster, but the blast radius is high because many renderers depend on local helpers, theme state, sync context, and OpenTUI-specific components.

### Leave Dispatch Inline

Leaving dispatch inline avoids churn, but it keeps a repeated source of fragility in the largest TUI route file.

### Introduce a Plugin-Based Renderer API Now

A plugin renderer API may be useful later, but it is not needed for the current maintenance problem. The current goal is a local static dispatch boundary.

## Acceptance Criteria

- A renderer-free helper module owns tool renderer key selection and coalesced labels.
- `index.tsx` dispatches specialized tool renderers through a registry.
- Unknown tools still use `GenericTool`.
- Focused tests cover known renderer selection, fallback selection, and coalesced labels.
- Existing TUI session view-model and layering checks continue to pass.

