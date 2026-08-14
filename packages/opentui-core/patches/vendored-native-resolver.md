# `vendored-native-resolver`

Upstream resolves the Zig shared library by dynamically importing
`@opentui/core-<platform>` npm packages. AX Code vendors the binaries under
`packages/opentui-core/vendor/<target>/` and must load them relative to the
package so enterprise/offline installs do not hit the registry.

## Contract

1. `resolveVendoredNativeTarget()` maps `(platform, arch, OPENTUI_LIBC)` to a
   vendor directory key.
2. The resolved path is `./vendor/<target>/libopentui.{dylib,so,dll}` relative
   to the FFI module (via `import.meta.url`).
3. The bundle must not contain `import("@opentui/core-`.

Regression: `packages/ax-code/test/cli/tui/opentui-vendored-native-resolver.test.ts`.
