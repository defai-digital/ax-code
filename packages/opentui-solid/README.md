# @ax-code/opentui-solid

Vendored fork of [@opentui/solid](https://github.com/anomalyco/opentui) — SolidJS renderer for the OpenTUI terminal rendering framework. Independently maintained in the ax-code workspace.

## Usage in ax-code

This package is consumed via the `solid-loader.mjs` (source dev) and `esbuild-solid-plugin.ts` (build). Both configure the Babel + Solid JSX transform with `moduleName: "@ax-code/opentui-solid"` so `.tsx` files compile to OpenTUI universal renderer calls.

```tsx
import { render, useKeyboard, useTerminalDimensions } from "@ax-code/opentui-solid"

render(() => <text>Hello, World!</text>)
```

Custom renderables are registered via `extend()`:

```tsx
import { extend } from "@ax-code/opentui-solid"

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

OpenTUI Solid exposes intrinsic JSX elements that map to OpenTUI renderables:

- **Layout & Display:** `text`, `box`, `scrollbox`, `ascii_font`
- **Input:** `input`, `textarea`, `select`, `tab_select`
- **Code & Diff:** `code`, `line_number`, `diff`
- **Text Modifiers:** `span`, `strong`, `b`, `em`, `i`, `u`, `br`, `a`

## API Reference

### `render(node, rendererOrConfig?)`

Render a Solid component tree into a CLI renderer. If `rendererOrConfig` is omitted, a renderer is created with default options.

```tsx
import { render } from "@ax-code/opentui-solid"

render(() => <App />)
```

**Parameters:**

- `node`: Function returning a JSX element.
- `rendererOrConfig?`: `CliRenderer` instance or `CliRendererConfig`.

### `testRender(node, options?)`

Create a test renderer for snapshots and interaction tests.

```tsx
import { testRender } from "@ax-code/opentui-solid"

const testSetup = await testRender(() => <App />, { width: 40, height: 10 })
```

### `extend(components)`

Register custom renderables as JSX intrinsic elements.

```tsx
import { extend } from "@ax-code/opentui-solid"

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
import { Portal } from "@ax-code/opentui-solid"
;<Portal mount={renderer.root}>
  <box border>Overlay</box>
</Portal>
```

### `Dynamic`

Render arbitrary intrinsic elements or components dynamically.

```tsx
import { Dynamic } from "@ax-code/opentui-solid"
;<Dynamic component={isMultiline() ? "textarea" : "input"} />
```

## Components

### Layout & Display

- `text`: styled text container
- `box`: layout container with borders, padding, and flex settings
- `scrollbox`: scrollable container
- `ascii_font`: ASCII art text renderer

QR code support is available from `@opentui/qrcode/solid` and must be registered explicitly with `registerQRCode()`.

### Input

- `input`: single-line text input
- `textarea`: multi-line text input
- `select`: list selection
- `tab_select`: tab-based selection

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
