# `@ax-code/tui`

AX Code's private terminal UI framework. It combines the native renderer, SolidJS reconciler, JSX runtime, test
utilities, build transform, and AX spinner component in one workspace package.

## Imports

```ts
import { RGBA, TextRenderable } from "@ax-code/tui"
import { render, useKeyboard } from "@ax-code/tui/solid"
import { SpinnerRenderable } from "@ax-code/tui/spinner"
import "@ax-code/tui/spinner/solid"
```

Application code should use only documented package exports. Do not import files from the package directory directly.

## Maintenance

The renderer and native libraries retain third-party MIT lineage. See [UPSTREAM.md](./UPSTREAM.md),
[DIVERGENCES.md](./DIVERGENCES.md), [MAINTENANCE.md](./MAINTENANCE.md), and [LICENSE](./LICENSE).
