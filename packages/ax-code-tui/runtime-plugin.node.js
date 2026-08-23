const errorMessage =
  "@ax-code/tui/runtime-plugin is Bun-only and is not available in Node.js. Use Bun to import this entrypoint."

export function createRuntimePlugin() {
  throw new Error(
    "@ax-code/tui/runtime-plugin is Bun-only and is not available in Node.js. Use Bun to import this entrypoint.",
  )
}

export function isCoreRuntimeModuleSpecifier() {
  throw new Error(
    "@ax-code/tui/runtime-plugin is Bun-only and is not available in Node.js. Use Bun to import this entrypoint.",
  )
}

export function runtimeModuleIdForSpecifier() {
  throw new Error(
    "@ax-code/tui/runtime-plugin is Bun-only and is not available in Node.js. Use Bun to import this entrypoint.",
  )
}

throw new Error(errorMessage)
