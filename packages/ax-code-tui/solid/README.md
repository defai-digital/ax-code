# @ax-code/tui/solid

AX Code's SolidJS reconciler and JSX runtime for `@ax-code/tui`.

## Usage in ax-code

This subpath is consumed via `solid-loader.mjs` (source development) and `esbuild-solid-plugin.ts` (build). Both configure the Babel + Solid JSX transform with `moduleName: "@ax-code/tui/solid"` so `.tsx` files compile to AX Code TUI universal renderer calls.

See [`../MAINTENANCE.md`](../MAINTENANCE.md) for the shared ownership boundary and update workflow.

Build scripts should use the stable `@ax-code/tui/solid/transform` export for Solid JSX transforms. Do not resolve internal files next to `./bun-plugin`.

```tsx
import { render, useKeyboard, useTerminalDimensions } from "@ax-code/tui/solid"

render(() => <text>Hello, World!</text>)
```

Custom renderables are registered via `extend()`:

```tsx
import { extend } from "@ax-code/tui/solid"

extend({ customBox: CustomBoxRenderable })
```

## Table of Contents

- [Core Concepts](#core-concepts)
  - [Components](#components)
- [API Reference](#api-reference)
  - [render(node, rendererOrConfig?)](#rendernode-rendererorconfig)
  - [testRender(node, options?)](#testrendernode-options)
  - [extend(components)](#extendcomponents)
  - [getComponentCatalogue()](#getcomponentcatalogue)
  - [Hooks](#hooks)
  - [Portal](#portal)
  - [Dynamic](#dynamic)
- [Components](#components-1)
  - [Layout & Display](#layout--display)
  - [Input](#input)
  - [Code & Diff](#code--diff)
  - [Text Modifiers](#text-modifiers)

## Core Concepts

### Components

AX Code TUI Solid exposes intrinsic JSX elements that map to AX renderables:

- **Layout & Display:** `text`, `box`, `scrollbox`
- **Input:** `input`, `textarea`
- **Code & Diff:** `code`, `line_number`, `diff`
- **Text Modifiers:** `span`, `strong`, `b`, `em`, `i`, `u`, `br`, `a`

## API Reference

### `render(node, rendererOrConfig?)`

Render a Solid component tree into a CLI renderer. If `rendererOrConfig` is omitted, a renderer is created with default options.

```tsx
import { render } from "@ax-code/tui/solid"

render(() => <App />)
```

**Parameters:**

- `node`: Function returning a JSX element.
- `rendererOrConfig?`: `CliRenderer` instance or `CliRendererConfig`.

### `testRender(node, options?)`

Create a test renderer for snapshots and interaction tests.

```tsx
import { testRender } from "@ax-code/tui/solid"

const testSetup = await testRender(() => <App />, { width: 40, height: 10 })
```

### `extend(components)`

Register custom renderables as JSX intrinsic elements.

```tsx
import { extend } from "@ax-code/tui/solid"

extend({ customBox: CustomBoxRenderable })
```

### `getComponentCatalogue()`

Returns the current component catalogue that powers JSX tag lookup.

### Hooks

- `useRenderer()`
- `onResize(callback)`
- `onFocus(callback)`
- `onBlur(callback)`
- `useTerminalDimensions()`
- `useKeyboard(handler, options?)`
- `usePaste(handler)`
- `useSelectionHandler(handler)`
- `useTimeline(options?)`

### `Portal`

Render children into a different mount node, useful for overlays and tooltips.

```tsx
import { Portal } from "@ax-code/tui/solid"
;<Portal mount={renderer.root}>
  <box border>Overlay</box>
</Portal>
```

### `Dynamic`

Render arbitrary intrinsic elements or components dynamically.

```tsx
import { Dynamic } from "@ax-code/tui/solid"
;<Dynamic component={isMultiline() ? "textarea" : "input"} />
```

## Components

### Layout & Display

- `text`: styled text container
- `box`: layout container with borders, padding, and flex settings
- `scrollbox`: scrollable container

### Input

- `input`: single-line text input
- `textarea`: multi-line text input

### Code & Diff

- `code`: syntax-highlighted code blocks
- `line_number`: line-numbered code display with diff/diagnostic helpers
- `diff`: unified or split diff viewer

### Text Modifiers

These must appear inside a `text` component:

- `span`: inline styled text
- `strong`/`b`: bold text
- `em`/`i`: italic text
- `u`: underline text
- `br`: line break
- `a`: link text with `href`
