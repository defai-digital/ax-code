# @ax-code/opentui-core

Vendored fork of [OpenTUI](https://github.com/anomalyco/opentui) core — a native terminal UI engine written in Zig with TypeScript bindings. This fork is independently maintained in the ax-code workspace.

OpenTUI provides a component-based architecture with flexible layout capabilities (Yoga), native Unicode rendering, mouse/keyboard event handling, and high-performance terminal output. It powers the ax-code TUI in production.

## Usage

```typescript
import { createCliRenderer, TextRenderable } from "@ax-code/opentui-core"

const renderer = await createCliRenderer()

const obj = new TextRenderable(renderer, { id: "my-obj", content: "Hello, world!" })

renderer.root.add(obj)
```

## Native Platform Packages

This package dynamically loads the matching native binary from `@opentui/core-<platform>` via `optionalDependencies`. Those upstream packages contain the compiled Zig `.dylib`/`.so`/`.dll` and are not renamed.

## License

MIT — see [LICENSE](./LICENSE).
