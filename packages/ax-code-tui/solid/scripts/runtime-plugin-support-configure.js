import { plugin as registerBunPlugin } from "bun";
import * as coreRuntime from "@ax-code/tui";
import { createRuntimePlugin, isCoreRuntimeModuleSpecifier, runtimeModuleIdForSpecifier, } from "@ax-code/tui/runtime-plugin";
import * as solidJsRuntime from "solid-js";
import * as solidJsStoreRuntime from "solid-js/store";
import * as solidRuntime from "@ax-code/tui/solid";
import { ensureSolidTransformPlugin } from "./solid-plugin.js";
const runtimePluginSupportInstalledKey = Symbol.for("ax-code.tui.solid.runtime-plugin-support");
const defaultRuntimeModules = {
    "@ax-code/tui/solid": solidRuntime,
    "solid-js": solidJsRuntime,
    "solid-js/store": solidJsStoreRuntime,
};
function normalizeRewriteKey(rewrite) {
    return `${rewrite?.nodeModulesRuntimeSpecifiers ?? true}:${rewrite?.nodeModulesBareSpecifiers ?? false}`;
}
function createRuntimeModules(options) {
    return {
        ...defaultRuntimeModules,
        ...(options?.additional ?? {}),
    };
}
function assertCompatibleInstall(install, modules, options) {
    for (const specifier of Object.keys(modules)) {
        if (!install.specifiers.has(specifier)) {
            throw new Error(`AX Code TUI Solid runtime plugin support is already installed without ${specifier}. Call ensureRuntimePluginSupport({ additional }) from @ax-code/tui/solid/runtime-plugin-support/configure before importing @ax-code/tui/solid/runtime-plugin-support.`);
        }
    }
    if (options?.core && options.core !== install.core) {
        throw new Error("AX Code TUI Solid runtime plugin support is already installed with a different core runtime module.");
    }
    if (options?.rewrite && normalizeRewriteKey(options.rewrite) !== install.rewriteKey) {
        throw new Error("AX Code TUI Solid runtime plugin support is already installed with different rewrite options.");
    }
}
export function ensureRuntimePluginSupport(options = {}) {
    const state = globalThis;
    const modules = createRuntimeModules(options);
    const core = options.core ?? coreRuntime;
    const rewriteKey = normalizeRewriteKey(options.rewrite);
    const install = state[runtimePluginSupportInstalledKey];
    if (install) {
        assertCompatibleInstall(install, modules, options);
        return false;
    }
    ensureSolidTransformPlugin({
        moduleName: runtimeModuleIdForSpecifier("@ax-code/tui/solid"),
        resolvePath(specifier) {
            if (!isCoreRuntimeModuleSpecifier(specifier) && !modules[specifier]) {
                return null;
            }
            return runtimeModuleIdForSpecifier(specifier);
        },
    });
    registerBunPlugin(createRuntimePlugin({
        core,
        additional: modules,
        rewrite: options.rewrite,
    }));
    state[runtimePluginSupportInstalledKey] = {
        specifiers: new Set(Object.keys(modules)),
        core,
        rewriteKey,
    };
    return true;
}
