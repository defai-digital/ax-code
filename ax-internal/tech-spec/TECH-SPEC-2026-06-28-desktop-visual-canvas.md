# Tech Spec: Desktop Visual Canvas

**Date:** 2026-06-28
**Status:** Draft
**Related:** `PRD-2026-06-28-desktop-visual-canvas.md`, `ADR-041-desktop-visual-canvas-boundary.md`

---

## Summary

Implement a native AX Code Desktop canvas MVP with project-local persistence and a context-panel UI. The first slice deliberately avoids Cowart source code and avoids tldraw. It establishes the AX-owned contract that later rich-canvas and AI image workflows can build on.

## Architecture

```text
desktop/packages/ui
  CanvasPanel.tsx
    GET /api/canvas?directory=<project>
    PUT /api/canvas?directory=<project>

desktop/packages/web/server/lib/canvas
  routes.js
  store.js
  validation.js

project
  .ax-code/canvas/main.canvas.json
  .ax-code/canvas/assets/
```

## Server Contract

### GET `/api/canvas`

Query:

- `directory`: project directory.

Response:

```json
{
  "document": {
    "version": 1,
    "id": "main",
    "title": "Project Canvas",
    "elements": [],
    "updatedAt": "2026-06-28T00:00:00.000Z"
  },
  "path": "/project/.ax-code/canvas/main.canvas.json"
}
```

If no file exists, the route returns a default empty document and does not create the file until the first save.

### PUT `/api/canvas`

Query:

- `directory`: project directory.

Body:

```json
{
  "document": {
    "version": 1,
    "id": "main",
    "title": "Project Canvas",
    "elements": []
  }
}
```

Behavior:

- Resolve and validate `directory` through Desktop's existing project-directory runtime.
- Sanitize and validate the document.
- Write atomically to `.ax-code/canvas/main.canvas.json`.
- Return the saved document and path.

## Document Model

```ts
type CanvasDocument = {
  version: 1
  id: "main"
  title: string
  elements: CanvasElement[]
  updatedAt: string
}

type CanvasElement =
  | {
      id: string
      type: "note"
      x: number
      y: number
      width: number
      height: number
      text: string
      color: "yellow" | "blue" | "green" | "pink"
    }
  | {
      id: string
      type: "image-slot"
      x: number
      y: number
      width: number
      height: number
      label: string
      role: "reference" | "generated-target"
      assetId: string | null
    }
```

MVP constraints:

- Clamp coordinates and dimensions to sane finite ranges.
- Limit element count.
- Limit text length.
- Generate client-side IDs with a simple `canvas-<timestamp>-<random>` shape.

## UI Contract

Add `canvas` as a context-panel mode:

- Label: `Canvas`
- Icon: use an existing drawing/layout icon.
- Dedupe key: `canvas`
- Target path: `null`

The panel should:

- Load the current project canvas.
- Render an unframed work surface inside the context panel.
- Let users add notes and image slots.
- Let users drag elements.
- Let users edit note text and slot labels.
- Autosave after changes with debounce.
- Show save state and error state.

The MVP should not:

- Import tldraw.
- Add image generation.
- Add asset upload.
- Add real-time collaboration.
- Add non-English strings.

## Integration Points

### Context Panel Store

Extend:

- `ContextPanelMode`
- context tab sanitization
- tab labeling/icon logic
- `openContextCanvas(directory)`

### Header or Context Entry Point

Add a small icon button near existing right/context controls that opens Canvas for the effective directory. The action should use `openContextCanvas(directory)`.

### Desktop Web Server

Register canvas routes after authentication/common middleware and before static routes. Reuse `resolveProjectDirectory` or `resolveOptionalProjectDirectory` for directory validation.

## Tests

Server tests:

- GET creates a default response for a valid project without writing a file.
- PUT writes a sanitized versioned document under `.ax-code/canvas/main.canvas.json`.
- Invalid documents are rejected.
- Directory traversal/path abuse is rejected by route validation.

UI tests:

- Store sanitization keeps `canvas` tabs.
- `openContextCanvas` creates a context panel tab with mode `canvas`.

## Future Work

### M2: Visual Context Bridge

- Convert selected canvas elements into markdown.
- Add selected canvas context to chat draft.
- Attach canvas screenshots or imported images.

### M3: Generated Image Slots

- Add slot fill request contract.
- Insert generated assets into `.ax-code/canvas/assets`.
- Preserve slot aspect ratio.

### M4: Rich Engine

- Evaluate tldraw after the AX document/API contract is stable.
- If adopted, store engine snapshots under a versioned optional field rather than making them the only source of truth.
