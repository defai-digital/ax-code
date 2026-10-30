const errorMessage = "@defai-digital/ax-tui/solid/runtime-plugin-support is Bun-only and is not available in Node.js. Use Bun to import this entrypoint.";
function ensureRuntimePluginSupport() {
  throw new Error(errorMessage);
}
throw new Error(errorMessage);
export {
  ensureRuntimePluginSupport
};
