const errorMessage = "@defai-digital/ax-tui/runtime-plugin is Bun-only and is not available in Node.js. Use Bun to import this entrypoint.";
function createRuntimePlugin() {
  throw new Error(
    "@defai-digital/ax-tui/runtime-plugin is Bun-only and is not available in Node.js. Use Bun to import this entrypoint."
  );
}
function isCoreRuntimeModuleSpecifier() {
  throw new Error(
    "@defai-digital/ax-tui/runtime-plugin is Bun-only and is not available in Node.js. Use Bun to import this entrypoint."
  );
}
function runtimeModuleIdForSpecifier() {
  throw new Error(
    "@defai-digital/ax-tui/runtime-plugin is Bun-only and is not available in Node.js. Use Bun to import this entrypoint."
  );
}
throw new Error(errorMessage);
export {
  createRuntimePlugin,
  isCoreRuntimeModuleSpecifier,
  runtimeModuleIdForSpecifier
};
