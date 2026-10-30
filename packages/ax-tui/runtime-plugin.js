import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as coreRuntime from "./index.js";
const CORE_RUNTIME_SPECIFIER = "@defai-digital/ax-tui";
const CORE_TESTING_RUNTIME_SPECIFIER = "@defai-digital/ax-tui/testing";
const RUNTIME_MODULE_PREFIX = "ax-code-tui:runtime-module:";
const MAX_RUNTIME_RESOLVE_PARENTS = 64;
const DEFAULT_RUNTIME_PLUGIN_REWRITE_OPTIONS = {
  nodeModulesRuntimeSpecifiers: true,
  nodeModulesBareSpecifiers: false
};
const DEFAULT_CORE_RUNTIME_MODULE_SPECIFIERS = [
  CORE_RUNTIME_SPECIFIER,
  CORE_TESTING_RUNTIME_SPECIFIER,
  "ax-tui",
  "ax-tui/testing"
];
const DEFAULT_CORE_RUNTIME_MODULE_SPECIFIER_SET = new Set(DEFAULT_CORE_RUNTIME_MODULE_SPECIFIERS);
const isCoreRuntimeModuleSpecifier = (specifier) => {
  return DEFAULT_CORE_RUNTIME_MODULE_SPECIFIER_SET.has(specifier);
};
const loadCoreTestingRuntimeModule = async () => {
  return await import("./testing.js");
};
const escapeRegExp = (value) => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};
const exactSpecifierFilter = (specifier) => {
  return new RegExp(`^${escapeRegExp(specifier)}$`);
};
const exactPathFilter = (paths) => {
  const candidates = [...new Set(paths.map(sourcePath))];
  return new RegExp(`^(?:${candidates.map(escapeRegExp).join("|")})(?:[?#].*)?$`);
};
const runtimeModuleIdForSpecifier = (specifier) => {
  const identity = specifier.replace(/^@defai-digital\/ax-tui(?=\/|$)/, "ax-tui");
  return `${RUNTIME_MODULE_PREFIX}${encodeURIComponent(identity)}`;
};
const resolveRuntimeModuleExports = async (moduleEntry) => {
  if (typeof moduleEntry === "function") {
    return await moduleEntry();
  }
  return moduleEntry;
};
const sourcePath = (path) => {
  const searchIndex = path.indexOf("?");
  const hashIndex = path.indexOf("#");
  const end = [searchIndex, hashIndex].filter((index) => index >= 0).sort((a, b) => a - b)[0];
  return end === void 0 ? path : path.slice(0, end);
};
const normalizedSourcePathByPath = /* @__PURE__ */ new Map();
const normalizeSourcePath = (path) => {
  const cleanPath = sourcePath(path);
  const cachedPath = normalizedSourcePathByPath.get(cleanPath);
  if (cachedPath !== void 0) {
    return cachedPath;
  }
  let normalizedPath = cleanPath;
  try {
    normalizedPath = realpathSync(cleanPath);
  } catch {
    normalizedPath = cleanPath;
  }
  normalizedSourcePathByPath.set(cleanPath, normalizedPath);
  return normalizedPath;
};
const isNodeModulesPath = (path) => {
  return /(?:^|[/\\])node_modules(?:[/\\])/.test(path);
};
const packageTypeForPath = (path, packageTypeByPackageJsonPath) => {
  let currentDir = dirname(path);
  while (true) {
    const packageJsonPath = join(currentDir, "package.json");
    if (existsSync(packageJsonPath)) {
      const cachedPackageType = packageTypeByPackageJsonPath.get(packageJsonPath);
      if (cachedPackageType) {
        return cachedPackageType;
      }
      let packageType = "commonjs";
      try {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
        if (packageJson.type === "module") {
          packageType = "module";
        }
      } catch {
        packageType = "commonjs";
      }
      packageTypeByPackageJsonPath.set(packageJsonPath, packageType);
      return packageType;
    }
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      return "commonjs";
    }
    currentDir = parentDir;
  }
};
const isNodeModulesEsmPath = (path, packageTypeByPackageJsonPath) => {
  const normalizedPath = normalizeSourcePath(path);
  if (!isNodeModulesPath(normalizedPath)) {
    return false;
  }
  if (normalizedPath.endsWith(".mjs") || normalizedPath.endsWith(".mts") || normalizedPath.endsWith(".ts") || normalizedPath.endsWith(".tsx") || normalizedPath.endsWith(".jsx")) {
    return true;
  }
  if (normalizedPath.endsWith(".cjs") || normalizedPath.endsWith(".cts") || !normalizedPath.endsWith(".js")) {
    return false;
  }
  return packageTypeForPath(normalizedPath, packageTypeByPackageJsonPath) === "module";
};
const nodeModulesPackageRootForPath = (path) => {
  let currentDir = dirname(path);
  while (true) {
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }
    if (basename(parentDir) === "node_modules") {
      return currentDir;
    }
    if (basename(dirname(parentDir)) === "node_modules" && basename(parentDir).startsWith("@")) {
      return currentDir;
    }
    currentDir = parentDir;
  }
};
const resolveRuntimePluginRewriteOptions = (options) => {
  return {
    nodeModulesRuntimeSpecifiers: options?.nodeModulesRuntimeSpecifiers ?? DEFAULT_RUNTIME_PLUGIN_REWRITE_OPTIONS.nodeModulesRuntimeSpecifiers,
    nodeModulesBareSpecifiers: options?.nodeModulesBareSpecifiers ?? DEFAULT_RUNTIME_PLUGIN_REWRITE_OPTIONS.nodeModulesBareSpecifiers
  };
};
const runtimeLoaderForPath = (path) => {
  const cleanPath = sourcePath(path);
  if (cleanPath.endsWith(".tsx")) {
    return "tsx";
  }
  if (cleanPath.endsWith(".jsx")) {
    return "jsx";
  }
  if (cleanPath.endsWith(".ts") || cleanPath.endsWith(".mts") || cleanPath.endsWith(".cts")) {
    return "ts";
  }
  if (cleanPath.endsWith(".js") || cleanPath.endsWith(".mjs") || cleanPath.endsWith(".cjs")) {
    return "js";
  }
  return null;
};
const resolveImportSpecifierPatterns = [
  /(from\s+["'])([^"']+)(["'])/g,
  /(import\s+["'])([^"']+)(["'])/g,
  /(import\s*\(\s*["'])([^"']+)(["']\s*\))/g,
  /(require\s*\(\s*["'])([^"']+)(["']\s*\))/g
];
const isBareSpecifier = (specifier) => {
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("\\")) {
    return false;
  }
  if (specifier.startsWith("node:") || specifier.startsWith("bun:") || specifier.startsWith("http:") || specifier.startsWith("https:") || specifier.startsWith("file:") || specifier.startsWith("data:")) {
    return false;
  }
  if (specifier.startsWith(RUNTIME_MODULE_PREFIX)) {
    return false;
  }
  return true;
};
const registerResolveParent = (resolveParentsByRecency, resolveParent) => {
  const existingIndex = resolveParentsByRecency.indexOf(resolveParent);
  if (existingIndex >= 0) {
    resolveParentsByRecency.splice(existingIndex, 1);
  }
  resolveParentsByRecency.push(resolveParent);
  if (resolveParentsByRecency.length > MAX_RUNTIME_RESOLVE_PARENTS) {
    resolveParentsByRecency.shift();
  }
};
const rewriteImportSpecifiers = (code, resolveReplacement) => {
  let transformedCode = code;
  for (const pattern of resolveImportSpecifierPatterns) {
    transformedCode = transformedCode.replace(pattern, (fullMatch, prefix, specifier, suffix) => {
      const replacement = resolveReplacement(specifier);
      if (!replacement || replacement === specifier) {
        return fullMatch;
      }
      return `${prefix}${replacement}${suffix}`;
    });
  }
  return transformedCode;
};
const collectImportSpecifiers = (code) => {
  const specifiers = /* @__PURE__ */ new Set();
  for (const pattern of resolveImportSpecifierPatterns) {
    code.replace(pattern, (_fullMatch, _prefix, specifier) => {
      specifiers.add(specifier);
      return _fullMatch;
    });
  }
  return [...specifiers];
};
const resolveFromParent = (specifier, parent) => {
  try {
    const resolvedSpecifier = import.meta.resolve(specifier, parent);
    if (resolvedSpecifier === specifier || resolvedSpecifier.startsWith("node:") || resolvedSpecifier.startsWith("bun:")) {
      return null;
    }
    return resolvedSpecifier;
  } catch {
    return null;
  }
};
const resolveSourcePathFromSpecifier = (specifier, importer) => {
  if (specifier.startsWith("node:") || specifier.startsWith("bun:") || specifier.startsWith("http:") || specifier.startsWith("https:") || specifier.startsWith("data:") || specifier.startsWith(RUNTIME_MODULE_PREFIX)) {
    return null;
  }
  if (specifier.startsWith("file:")) {
    return sourcePath(fileURLToPath(specifier));
  }
  if (isAbsolute(specifier)) {
    return sourcePath(specifier);
  }
  const resolvedSpecifier = resolveFromParent(specifier, importer);
  if (!resolvedSpecifier) {
    return null;
  }
  if (resolvedSpecifier.startsWith("file:")) {
    return sourcePath(fileURLToPath(resolvedSpecifier));
  }
  if (isAbsolute(resolvedSpecifier)) {
    return sourcePath(resolvedSpecifier);
  }
  return null;
};
const rewriteImportsFromResolveParents = (code, resolveParentsByRecency) => {
  if (resolveParentsByRecency.length === 0) {
    return code;
  }
  const resolveFromParents = (specifier) => {
    if (!isBareSpecifier(specifier)) {
      return null;
    }
    for (let index = resolveParentsByRecency.length - 1; index >= 0; index -= 1) {
      const resolveParent = resolveParentsByRecency[index];
      const resolvedSpecifier = resolveFromParent(specifier, resolveParent);
      if (resolvedSpecifier) {
        return resolvedSpecifier;
      }
    }
    return null;
  };
  return rewriteImportSpecifiers(code, resolveFromParents);
};
const rewriteRuntimeSpecifiers = (code, runtimeModuleIdsBySpecifier) => {
  return rewriteImportSpecifiers(code, (specifier) => {
    const runtimeModuleId = runtimeModuleIdsBySpecifier.get(specifier);
    return runtimeModuleId ?? null;
  });
};
function createRuntimePlugin(input = {}) {
  const runtimeModules = /* @__PURE__ */ new Map();
  runtimeModules.set(CORE_RUNTIME_SPECIFIER, input.core ?? coreRuntime);
  runtimeModules.set(CORE_TESTING_RUNTIME_SPECIFIER, loadCoreTestingRuntimeModule);
  runtimeModules.set("ax-tui", input.core ?? coreRuntime);
  runtimeModules.set("ax-tui/testing", loadCoreTestingRuntimeModule);
  const rewriteOptions = resolveRuntimePluginRewriteOptions(input.rewrite);
  for (const [specifier, moduleEntry] of Object.entries(input.additional ?? {})) {
    runtimeModules.set(specifier, moduleEntry);
    const alias = specifier.startsWith("@defai-digital/ax-tui") ? specifier.replace(/^@defai-digital\/ax-tui(?=\/|$)/, "ax-tui") : specifier.replace(/^ax-tui(?=\/|$)/, "@defai-digital/ax-tui");
    if (runtimeModules.has(alias)) runtimeModules.set(alias, moduleEntry);
  }
  const runtimeModuleIdsBySpecifier = /* @__PURE__ */ new Map();
  for (const specifier of runtimeModules.keys()) {
    runtimeModuleIdsBySpecifier.set(specifier, runtimeModuleIdForSpecifier(specifier));
  }
  return {
    name: "bun-plugin-ax-code-tui-runtime-modules",
    setup: (build) => {
      const resolveParentsByRecency = [];
      const installedRewriteLoaders = /* @__PURE__ */ new Set();
      const nodeModulesBareRewritePackageRoots = /* @__PURE__ */ new Set();
      const packageTypeByPackageJsonPath = /* @__PURE__ */ new Map();
      const sourceAnalysisByPath = /* @__PURE__ */ new Map();
      const nodeModulesRuntimeRewritePathsByPath = /* @__PURE__ */ new Map();
      const installRewriteLoader = (path) => {
        const resolvedTargetPath = sourcePath(path);
        const canonicalTargetPath = normalizeSourcePath(resolvedTargetPath);
        if (installedRewriteLoaders.has(canonicalTargetPath)) {
          return;
        }
        installedRewriteLoaders.add(canonicalTargetPath);
        build.onLoad({ filter: exactPathFilter([resolvedTargetPath, canonicalTargetPath]) }, async (args) => {
          const loadedPath = normalizeSourcePath(args.path);
          if (loadedPath !== canonicalTargetPath) {
            return void 0;
          }
          const nodeModulesPath = isNodeModulesPath(loadedPath);
          const shouldRewriteRuntimeSpecifiers = !nodeModulesPath || rewriteOptions.nodeModulesRuntimeSpecifiers;
          const shouldRewriteBareSpecifiers = !nodeModulesPath || rewriteOptions.nodeModulesBareSpecifiers;
          const loader = runtimeLoaderForPath(args.path);
          if (!loader) {
            throw new Error(`Unable to determine runtime loader for path: ${args.path}`);
          }
          const contents = await Bun.file(loadedPath).text();
          const runtimeRewrittenContents = shouldRewriteRuntimeSpecifiers ? rewriteRuntimeSpecifiers(contents, runtimeModuleIdsBySpecifier) : contents;
          if (runtimeRewrittenContents !== contents && shouldRewriteBareSpecifiers) {
            registerResolveParent(resolveParentsByRecency, loadedPath);
          }
          const transformedContents = shouldRewriteBareSpecifiers ? rewriteImportsFromResolveParents(runtimeRewrittenContents, resolveParentsByRecency) : runtimeRewrittenContents;
          return {
            contents: transformedContents,
            loader
          };
        });
      };
      const analyzeSourcePath = (path) => {
        const normalizedPath = normalizeSourcePath(path);
        const cachedAnalysis = sourceAnalysisByPath.get(normalizedPath);
        if (cachedAnalysis) {
          return cachedAnalysis;
        }
        let contents;
        try {
          contents = readFileSync(normalizedPath, "utf8");
        } catch (error) {
          if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
            const analysis2 = { importSpecifiers: [], needsRuntimeSpecifierRewrite: false };
            sourceAnalysisByPath.set(normalizedPath, analysis2);
            return analysis2;
          }
          throw error;
        }
        const importSpecifiers = collectImportSpecifiers(contents);
        const analysis = {
          importSpecifiers,
          needsRuntimeSpecifierRewrite: importSpecifiers.some(
            (specifier) => runtimeModuleIdsBySpecifier.has(specifier)
          )
        };
        sourceAnalysisByPath.set(normalizedPath, analysis);
        return analysis;
      };
      const collectNodeModulesRuntimeRewritePaths = (path, visiting = /* @__PURE__ */ new Set()) => {
        const normalizedPath = normalizeSourcePath(path);
        if (!isNodeModulesEsmPath(normalizedPath, packageTypeByPackageJsonPath)) {
          return [];
        }
        const cachedPaths = nodeModulesRuntimeRewritePathsByPath.get(normalizedPath);
        if (cachedPaths) {
          return cachedPaths;
        }
        if (visiting.has(normalizedPath)) {
          return [];
        }
        visiting.add(normalizedPath);
        const rewritePaths = /* @__PURE__ */ new Set();
        const analysis = analyzeSourcePath(normalizedPath);
        if (analysis.needsRuntimeSpecifierRewrite) {
          rewritePaths.add(normalizedPath);
        }
        for (const specifier of analysis.importSpecifiers) {
          const resolvedPath = resolveSourcePathFromSpecifier(specifier, normalizedPath);
          if (!resolvedPath || !isNodeModulesEsmPath(resolvedPath, packageTypeByPackageJsonPath)) {
            continue;
          }
          for (const nestedPath of collectNodeModulesRuntimeRewritePaths(resolvedPath, visiting)) {
            rewritePaths.add(nestedPath);
          }
        }
        visiting.delete(normalizedPath);
        const resolvedRewritePaths = [...rewritePaths];
        nodeModulesRuntimeRewritePathsByPath.set(normalizedPath, resolvedRewritePaths);
        return resolvedRewritePaths;
      };
      const registeredModuleIds = /* @__PURE__ */ new Set();
      for (const [specifier, moduleEntry] of runtimeModules.entries()) {
        const moduleId = runtimeModuleIdsBySpecifier.get(specifier);
        if (!moduleId) {
          continue;
        }
        if (!registeredModuleIds.has(moduleId)) {
          registeredModuleIds.add(moduleId);
          build.module(moduleId, async () => ({
            exports: await resolveRuntimeModuleExports(moduleEntry),
            loader: "object"
          }));
        }
        build.onResolve({ filter: exactSpecifierFilter(specifier) }, () => ({ path: moduleId }));
      }
      build.onResolve({ filter: /.*/ }, (args) => {
        if (runtimeModuleIdsBySpecifier.has(args.path) || args.path.startsWith(RUNTIME_MODULE_PREFIX)) {
          return void 0;
        }
        const path = resolveSourcePathFromSpecifier(args.path, args.importer);
        if (!path || !runtimeLoaderForPath(path)) {
          return void 0;
        }
        const nodeModulesPath = isNodeModulesPath(path);
        if (!nodeModulesPath) {
          installRewriteLoader(path);
          return void 0;
        }
        if (!rewriteOptions.nodeModulesRuntimeSpecifiers && !rewriteOptions.nodeModulesBareSpecifiers) {
          return void 0;
        }
        for (const rewritePath of collectNodeModulesRuntimeRewritePaths(path)) {
          installRewriteLoader(rewritePath);
        }
        const packageRoot = nodeModulesPackageRootForPath(path);
        if (rewriteOptions.nodeModulesBareSpecifiers && packageRoot && nodeModulesBareRewritePackageRoots.has(packageRoot)) {
          installRewriteLoader(path);
          return void 0;
        }
        if (!rewriteOptions.nodeModulesRuntimeSpecifiers || !analyzeSourcePath(path).needsRuntimeSpecifierRewrite) {
          return void 0;
        }
        if (rewriteOptions.nodeModulesBareSpecifiers && packageRoot) {
          nodeModulesBareRewritePackageRoots.add(packageRoot);
        }
        installRewriteLoader(path);
        return void 0;
      });
    }
  };
}
export {
  createRuntimePlugin,
  isCoreRuntimeModuleSpecifier,
  runtimeModuleIdForSpecifier
};
