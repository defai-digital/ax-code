import { plugin as registerBunPlugin } from "bun";
import { stripQueryAndHash, transformSolidSource } from "./solid-transform.js";
const solidTransformStateKey = /* @__PURE__ */ Symbol.for("ax-code.tui.solid.transform");
const getSolidTransformState = () => {
  const state = globalThis;
  state[solidTransformStateKey] ??= { installed: false };
  return state[solidTransformStateKey];
};
const getSolidTransformRuntime = () => {
  return getSolidTransformState().runtime ?? {};
};
const hasSolidTransformRuntime = (input) => {
  return input.moduleName !== void 0 || input.resolvePath !== void 0;
};
function ensureSolidTransformPlugin(input = {}) {
  const state = getSolidTransformState();
  if (hasSolidTransformRuntime(input)) {
    state.runtime = {
      moduleName: input.moduleName,
      resolvePath: input.resolvePath
    };
  }
  if (state.installed) {
    return false;
  }
  registerBunPlugin(createSolidTransformPlugin());
  state.installed = true;
  return true;
}
function resetSolidTransformPluginState() {
  const state = getSolidTransformState();
  state.installed = false;
  delete state.runtime;
}
function createSolidTransformPlugin(input = {}) {
  const sourceFilter = input.resolvePath ? /^(?!.*[/\\]node_modules[/\\]).*\.[cm]?[jt]sx?(?:[?#].*)?$/ : /^(?!.*[/\\]node_modules[/\\]).*\.[cm]?[jt]sx(?:[?#].*)?$/;
  return {
    name: "bun-plugin-solid",
    setup: (build) => {
      build.onLoad({ filter: /[/\\]node_modules[/\\]solid-js[/\\]dist[/\\]server\.js(?:[?#].*)?$/ }, async (args) => {
        const path = stripQueryAndHash(args.path).replace("server.js", "solid.js");
        const file = Bun.file(path);
        const code = await file.text();
        return { contents: code, loader: "js" };
      });
      build.onLoad(
        { filter: /[/\\]node_modules[/\\]solid-js[/\\]store[/\\]dist[/\\]server\.js(?:[?#].*)?$/ },
        async (args) => {
          const path = stripQueryAndHash(args.path).replace("server.js", "store.js");
          const file = Bun.file(path);
          const code = await file.text();
          return { contents: code, loader: "js" };
        }
      );
      build.onLoad({ filter: sourceFilter }, async (args) => {
        const path = stripQueryAndHash(args.path);
        const file = Bun.file(path);
        const code = await file.text();
        const runtime = getSolidTransformRuntime();
        const moduleName = input.moduleName ?? runtime.moduleName ?? "@defai-digital/ax-tui/solid";
        const resolvePath = input.resolvePath ?? runtime.resolvePath;
        const contents = await transformSolidSource(code, {
          filename: path,
          moduleName,
          resolvePath
        });
        return {
          contents,
          loader: "js"
        };
      });
    }
  };
}
const solidTransformPlugin = createSolidTransformPlugin();
var solid_plugin_default = solidTransformPlugin;
export {
  createSolidTransformPlugin,
  solid_plugin_default as default,
  ensureSolidTransformPlugin,
  resetSolidTransformPluginState
};
