# @ax-code/tui/spinner

AX Code's animated spinner renderable, maintained as part of `@ax-code/tui` with zero third-party runtime dependencies.

## Features

- **40 built-in presets** — inlined from `cli-spinners` (MIT, Sindre Sorhus), no external dependency
- **Per-character color generators** — pulse, wave, rainbow, static, or custom
- **Full input validation** — preset names, intervals, and frame arrays are validated at construction
- **Tree-shakeable** — import only what you need (`SpinnerRenderable`, presets, or color utilities)

## Import

```ts
import { SpinnerRenderable } from "@ax-code/tui/spinner"
```

The root renderer and Solid adapter are sibling exports of the same workspace package.

See [`../MAINTENANCE.md`](../MAINTENANCE.md) for the shared ownership boundary and update workflow.

## Usage

```ts
import { SpinnerRenderable } from "@ax-code/tui/spinner"

const spinner = new SpinnerRenderable(ctx, {
  name: "dots",
  color: "cyan",
})
```

### Custom frames

```ts
const spinner = new SpinnerRenderable(ctx, {
  frames: ["◐", "◓", "◑", "◒"],
  interval: 100,
  color: "#ff8800",
})
```

### Color effects

```ts
import { createWave, createRainbow, createPulse } from "@ax-code/tui/spinner"

// Rainbow gradient across characters
new SpinnerRenderable(ctx, { name: "aesthetic", color: createRainbow() })

// Pulsing color cycle
new SpinnerRenderable(ctx, { name: "arc", color: createPulse(["red", "blue"], 0.5) })

// Wave pattern
new SpinnerRenderable(ctx, { name: "bouncingBar", color: createWave(["#00ff00", "#0088ff"]) })
```

### SolidJS integration

```ts
import "@ax-code/tui/spinner/solid"

// <spinner name="dots" color="cyan" /> is now available in JSX
```

## API

### `SpinnerRenderable`

Extends `Renderable` from `@ax-code/tui`.

| Property            | Type                           | Description                           |
| ------------------- | ------------------------------ | ------------------------------------- |
| `name`              | `SpinnerName \| undefined`     | Get/set the active preset             |
| `frames`            | `string[]`                     | Get/set custom frame strings          |
| `interval`          | `number`                       | Get/set animation interval (ms)       |
| `color`             | `ColorInput \| ColorGenerator` | Solid color or per-char generator     |
| `backgroundColor`   | `ColorInput`                   | Background color                      |
| `running`           | `boolean` (read-only)          | Whether the animation timer is active |
| `currentFrameIndex` | `number` (read-only)           | Current position in the frame cycle   |

| Method    | Description             |
| --------- | ----------------------- |
| `start()` | Begin animation         |
| `stop()`  | Pause animation         |
| `reset()` | Jump to the first frame |

### Presets

```ts
import { getSpinnerPreset, getSpinnerNames, randomSpinner, presets } from "@ax-code/tui/spinner"
```

- `getSpinnerPreset(name)` — returns `SpinnerPreset | undefined`
- `getSpinnerNames()` — returns all 40 preset names
- `randomSpinner()` — returns a random `SpinnerPreset`
- `presets` — the full preset map (`Record<string, SpinnerPreset>`)

### Color utilities

```ts
import { createStatic, createPulse, createWave, createRainbow } from "@ax-code/tui/spinner"
```

- `createStatic(color)` — always returns the same color
- `createPulse(colors, speed?)` — cycles through colors per frame
- `createWave(colors)` — moving wave pattern across characters
- `createRainbow()` — HSL hue rotation across the spectrum
