# native-asset-delivery

The public GitHub Packages payload bundles all verified native binaries and licenses.
Keep the existing platform/architecture/libc mapping and delegate library preparation to
`native/index.js` through its public `prepareNativeLibrary` API.

`src/core/zig.ts` imports the package-owned resolver implemented in
`native/source/`. It preserves package-relative bundled assets,
native ABI names, FFI pointer guards, and renderer behavior. Missing bundled
assets use a bounded, manifest-verified cache/download path; offline mode
never accesses the network.

Regression guards: `script/tui-patches.test.ts` and
`test/native-delivery.test.ts`. Regenerate with `pnpm run build:renderer`;
never hand-edit the hashed renderer chunk.
