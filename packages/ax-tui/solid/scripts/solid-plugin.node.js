const errorMessage = "@defai-digital/ax-tui/solid/bun-plugin is Bun-only and is not available in Node.js. Use Bun to import this entrypoint.";
function ensureSolidTransformPlugin() {
  throw new Error(errorMessage);
}
function resetSolidTransformPluginState() {
  throw new Error(errorMessage);
}
function createSolidTransformPlugin() {
  throw new Error(errorMessage);
}
throw new Error(errorMessage);
export {
  createSolidTransformPlugin,
  ensureSolidTransformPlugin,
  resetSolidTransformPluginState
};
