const errorMessage =
  "@ax-code/opentui-solid/bun-plugin is Bun-only and is not available in Node.js. Use Bun to import this entrypoint."

export function ensureSolidTransformPlugin() {
  throw new Error(errorMessage)
}

export function resetSolidTransformPluginState() {
  throw new Error(errorMessage)
}

export function createSolidTransformPlugin() {
  throw new Error(errorMessage)
}

throw new Error(errorMessage)
