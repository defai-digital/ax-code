# PRD: Desktop Visual Canvas

**Date:** 2026-06-28
**Status:** Draft - proposal for ADR-041
**Scope:** Internal
**Owner:** ax-code maintainers
**Related:** ADR-018, ADR-020, ADR-021, ADR-029, ADR-035, ADR-037, ADR-038, ADR-039, ADR-041, `TECH-SPEC-2026-06-28-desktop-visual-canvas.md`
**Archive criteria:** AX Code Desktop ships a native project canvas that supports visual planning, annotation context, and AI-generated image placement through AX-owned APIs, or maintainers explicitly defer the visual workspace surface.

---

## Purpose

Add a native visual workspace to AX Code Desktop so users can sketch task plans, mark image slots, collect visual references, and feed visual context back into agent sessions without depending on a third-party plugin runtime.

This PRD uses Cowart as a reference for the workflow category, not as source code to vendor. The implementation must be AX-owned, English-first, permission-aware, and consistent with the Desktop architecture.

## Background

Cowart demonstrates a useful product pattern: a project-local infinite canvas with AI image holders, annotation-driven image edits, and MCP tools for inserting generated assets. The pattern fits AX Code Desktop because Desktop already owns richer visual surfaces than the terminal client and already contains browser/preview, project context, attachments, MCP, and agent supervision surfaces.

The Cowart codebase is not a good direct dependency for AX Code Desktop:

- It is plugin/demo shaped rather than product shaped.
- Vite configuration owns backend persistence behavior.
- Shell scripts install dependencies implicitly.
- Persistence is ad hoc under `canvas/`.
- MCP tools directly mutate tldraw snapshots.
- User-facing strings are not aligned to Desktop's English/i18n policy.
- License and long-term maintenance posture are not sufficient for vendoring.

The product opportunity remains valid: Desktop should offer a native visual workspace, but the code and contracts should be AX-owned.

## Problem

AX Code Desktop is strong at text sessions, file diffs, terminal work, preview inspection, and project notes. It lacks a first-class visual surface for:

1. Freeform task planning that is easier to express spatially than in a linear chat.
2. Screenshot and design annotation before asking an agent to implement or revise something.
3. Image generation slots that preserve intended aspect ratio and placement.
4. Project-local visual context that can be attached to future sessions.

Relying on an external plugin for this would fragment storage, lifecycle, permissions, UI copy, and support.

## Goals

1. Ship a native Desktop canvas MVP that works per project without external plugin installation.
2. Keep all new feature code and user-facing copy in English by default.
3. Store canvas data in an AX-owned project-local format with explicit versioning.
4. Provide a clean API boundary for canvas documents, elements, and assets.
5. Keep the first implementation narrow enough to validate architecture before adding tldraw or advanced editing.
6. Preserve a future path to image generation, annotation screenshots, MCP/tool insertion, and richer canvas engines.

## Non-Goals

- Do not vendor Cowart source code.
- Do not introduce tldraw in the first implementation slice.
- Do not build a full design tool, diagramming suite, or collaborative whiteboard.
- Do not implement image generation in the Desktop UI directly.
- Do not bypass AX Code permission, attachment, or MCP boundaries.
- Do not store visual workspace state in chat/session state.
- Do not add non-English feature copy unless a later localization pass explicitly does so.

## Users

### Developer planning a complex change

Wants to map components, risks, and steps spatially before starting an agent session.

### Frontend builder

Wants to collect screenshots, mark issues, and attach visual context to the agent.

### Product/maintainer reviewer

Wants a project-local board for visual notes that survives across sessions and can later feed implementation prompts.

### AI image workflow user

Wants to reserve image slots and ask AX Code to generate or revise assets with an explicit size/aspect contract.

## Product Requirements

### R1: Native Canvas Panel

Desktop must expose a project-scoped Canvas panel from the existing context panel system. The panel must open without installing plugins or starting a separate external service.

### R2: Project-Local Persistence

Canvas documents must persist under the active project in an AX-owned directory:

```text
.ax-code/canvas/main.canvas.json
.ax-code/canvas/assets/
```

The format must include a `version` field and be resilient to missing or malformed files.

### R3: Minimum Element Model

The MVP must support at least:

- Notes with editable text.
- Image placeholders with width, height, and an explicit role marker.
- Simple spatial positioning.

The model must be engine-neutral so a later tldraw-backed implementation can migrate from it or embed richer snapshots under a versioned field.

### R4: Explicit API Boundary

Desktop web server routes must own reading and writing canvas documents. UI code must not write project files directly.

### R5: Permission and Path Safety

Canvas routes must resolve the active project directory through existing Desktop project-directory validation. They must not accept arbitrary asset paths outside the project or approved roots.

### R6: Visual Context Bridge

The UI must make it clear that canvas content is project context. The first slice may stop at persistence and editing; later slices add "send canvas context to session" and image generation insertion.

### R7: Cowart-Inspired Future Workflow

The architecture must preserve a path for:

- AI image slot fill.
- Annotation screenshot attachment.
- Generated asset placement beside a source image.
- MCP/tool-based insertion.

These workflows are future milestones, not MVP blockers.

## Success Metrics

- A user can open Canvas for a project, create notes/placeholders, reload Desktop, and see the same canvas.
- The canvas API rejects invalid project directories and malformed payloads.
- Desktop typecheck and focused tests cover the storage/API contract.
- No Cowart source files or shell scripts are vendored.
- New feature copy is English.

## Risks

### MVP feels too simple compared with Cowart

Mitigation: Treat the first slice as an architecture foundation. Ship only the smallest native surface needed to prove storage, routing, and project integration.

### Canvas storage format changes later

Mitigation: Version the document from day one and keep the element model small. Add migration functions before introducing richer engines.

### Path writes create security holes

Mitigation: Route all access through existing project-directory validation and constrain writes to `.ax-code/canvas`.

### Feature drifts into a design tool

Mitigation: Keep scope tied to agent context and generated asset workflows, not general-purpose whiteboarding.

## Milestones

### M1: Native Canvas MVP

- Add PRD, ADR, and tech spec.
- Add project-local canvas storage routes.
- Add Canvas context-panel mode.
- Add simple note and image-slot creation, editing, movement, and persistence.
- Add focused storage/route tests.

### M2: Visual Context Attachments

- Summarize canvas elements into markdown context.
- Attach selected notes/placeholders to current draft/session.
- Add screenshot import as an asset reference.

### M3: AI Image Slot Fill

- Add tool/API contract for generated image insertion.
- Preserve slot dimensions and aspect ratio.
- Insert generated assets into `.ax-code/canvas/assets/`.

### M4: Rich Canvas Engine Evaluation

- Evaluate tldraw or a lighter engine against license, bundle size, serialization, theming, and Desktop packaging constraints.
- Migrate only if the native contract remains authoritative.
