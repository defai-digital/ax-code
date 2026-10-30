const errorMessage =
  "@defai-digital/ax-tui/runtime-plugin-support/configure is Bun-only and is not available in Node.js. Use Bun to import this entrypoint."

export function ensureRuntimePluginSupport() {
  throw new Error(
    "@defai-digital/ax-tui/runtime-plugin-support/configure is Bun-only and is not available in Node.js. Use Bun to import this entrypoint.",
  )
}

export function createRuntimePlugin() {
  throw new Error(
    "@defai-digital/ax-tui/runtime-plugin-support/configure is Bun-only and is not available in Node.js. Use Bun to import this entrypoint.",
  )
}

export function runtimeModuleIdForSpecifier() {
  throw new Error(
    "@defai-digital/ax-tui/runtime-plugin-support/configure is Bun-only and is not available in Node.js. Use Bun to import this entrypoint.",
  )
}

throw new Error(errorMessage)
