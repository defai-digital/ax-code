# AX Code Workspace SDK Contract Checklist

The desktop app consumes `@ax-code/sdk` from the workspace. SDK, server, and
Desktop changes can now land in one commit, but a few SDK internals are still
mirrored or patched in Desktop code. Re-verify those assumptions whenever a
Desktop change depends on new SDK behavior.

Work through this list when SDK exports, headless lifecycle behavior, or server
contracts change:

1. **Keep the contract test meaningful.**
   `packages/web/server/lib/ax-code/sdk-contract.test.js` must load the
   workspace SDK package, verify the public entrypoints Desktop imports, and
   check the headless lifecycle declaration shape.

2. **Re-verify the loopback guard mirror.** `isSdkLoopbackHostname` in
   `packages/web/server/lib/ax-code/lifecycle.js` mirrors the SDK's private
   `isLoopbackHostname` so the legacy `allowNetworkBind` option remains false for
   non-loopback hostnames. Compare the workspace SDK guard behavior against the
   mirror and the fixtures in `sdk-contract.test.js`.

3. **Re-verify the headless handle patch.** `createManagedAxCodeServerProcess`
   in `lifecycle.js` spreads `{ exitCode: null, signalCode: null }` onto the
   `startHeadlessBackend` handle because SDK handles lack child-process fields.
   If the SDK starts returning these fields, remove the patch.

4. **Re-verify explicit launcher options.** `startHeadlessBackend` must keep
   accepting `binary` and `args`. `lifecycle.js` depends on those options so
   macOS/Linux wrapper launches and custom binary names stay on the SDK-owned
   readiness/auth/diagnostics/shutdown path. If the SDK changes these options,
   update lifecycle.js and the wrapper-launch fixtures before shipping.

5. **Review the minimum supported runtime version.**
   `MIN_SUPPORTED_AX_CODE_VERSION` in
   `packages/web/server/lib/ax-code/version-compat.js` gates the installed
   ax-code CLI. Raise the minimum and note why in the constant's comment
   whenever the app starts depending on a server route or response shape that a
   newer ax-code introduced — this includes UI calls proxied straight to the
   runtime (e.g. `/api/provider/ax-engine/*` for the Models tab), not just SDK
   reads. Set it to the first ax-code release that ships the route. Skipping
   this turns a missing route into a bare "Provider request failed (404)"
   instead of the incompatible-runtime warning.

6. **Run the full gate from the monorepo root.** `pnpm run
check:desktop-boundaries && pnpm run desktop:test && pnpm run
desktop:typecheck && pnpm run desktop:build`.

Upstream integration context (transport choice, pending upstream feature
requests) lives in `docs/AX_CODE_INTEGRATION.md`.
