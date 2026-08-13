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

## Vendored Native Libraries

The compiled Zig native libraries (`libopentui.dylib`/`.so`, `opentui.dll`) are vendored in-repo under `vendor/<target>/` and hash-pinned by `vendor/manifest.json`. The runtime resolves them relative to this package — there is no dependency on the upstream `@opentui/core-<platform>` npm packages. Refresh with `pnpm vendor:opentui-native`; verify with `pnpm check:opentui-vendor`.

## Maintenance

See [MAINTENANCE.md](./MAINTENANCE.md) for the vendored fork ownership boundary, required ax-code fixes, and update verification workflow.

## License

MIT — see [LICENSE](./LICENSE).
