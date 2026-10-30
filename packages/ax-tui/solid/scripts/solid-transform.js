import { transformAsync } from "@babel/core";
import ts from "@babel/preset-typescript";
import moduleResolver from "babel-plugin-module-resolver";
import solid from "babel-preset-solid";
const nodeModulesPattern = /[/\\]node_modules[/\\]/;
const tsPattern = /\.[cm]?tsx?$/;
const jsxPattern = /\.[cm]?[jt]sx$/;
function stripQueryAndHash(path) {
  const searchIndex = path.indexOf("?");
  const hashIndex = path.indexOf("#");
  const end = [searchIndex, hashIndex].filter((index) => index >= 0).sort((a, b) => a - b)[0];
  return end === void 0 ? path : path.slice(0, end);
}
function isNodeModulesPath(path) {
  return nodeModulesPattern.test(path);
}
function resolveNodeSolidRuntimeImport(specifier) {
  switch (specifier) {
    case "solid-js":
      return "solid-js/dist/solid.js";
    case "solid-js/store":
      return "solid-js/store/dist/store.js";
    default:
      return null;
  }
}
async function transformSolidSource(code, options) {
  const filename = stripQueryAndHash(options.filename);
  const plugins = options.resolvePath ? [
    [
      moduleResolver,
      {
        resolvePath(specifier) {
          return options.resolvePath?.(specifier) ?? specifier;
        }
      }
    ]
  ] : [];
  const presets = [];
  if (jsxPattern.test(filename)) {
    presets.push([
      solid,
      {
        moduleName: options.moduleName ?? "@defai-digital/ax-tui/solid",
        generate: "universal"
      }
    ]);
  }
  if (tsPattern.test(filename)) {
    presets.push([ts]);
  }
  const transformed = await transformAsync(code, {
    filename,
    configFile: false,
    babelrc: false,
    plugins,
    presets
  });
  return transformed?.code ?? code;
}
export {
  isNodeModulesPath,
  resolveNodeSolidRuntimeImport,
  stripQueryAndHash,
  transformSolidSource
};
