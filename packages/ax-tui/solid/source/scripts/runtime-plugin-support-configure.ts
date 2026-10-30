/**
 * SolidJS build and runtime integration for AX TUI.
 *
 * @module
 */
export {}
import { plugin as registerBunPlugin } from "bun"
import * as coreRuntime from "@defai-digital/ax-tui"
import {
  createRuntimePlugin,
  isCoreRuntimeModuleSpecifier,
  runtimeModuleIdForSpecifier,
  type RuntimeModuleEntry,
  type RuntimePluginRewriteOptions,
} from "@defai-digital/ax-tui/runtime-plugin"
import * as solidJsRuntime from "solid-js"
import * as solidJsStoreRuntime from "solid-js/store"
import * as solidRuntime from "@defai-digital/ax-tui/solid"
import { ensureSolidTransformPlugin } from "./solid-plugin.js"

const runtimePluginSupportInstalledKey = Symbol.for("ax-code.tui.solid.runtime-plugin-support")

export interface SolidRuntimePluginSupportOptions {
  additional?: Record<string, RuntimeModuleEntry>
  core?: RuntimeModuleEntry
  rewrite?: RuntimePluginRewriteOptions
}

interface RuntimePluginSupportInstall {
  specifiers: ReadonlySet<string>
  core: RuntimeModuleEntry
  rewriteKey: string
}

type RuntimePluginSupportState = typeof globalThis & {
  [runtimePluginSupportInstalledKey]?: RuntimePluginSupportInstall
}

const defaultRuntimeModules: Record<string, RuntimeModuleEntry> = {
  "ax-tui/solid": solidRuntime as Record<string, unknown>,
  "@defai-digital/ax-tui/solid": solidRuntime as Record<string, unknown>,
  "solid-js": solidJsRuntime as Record<string, unknown>,
  "solid-js/store": solidJsStoreRuntime as Record<string, unknown>,
}

function normalizeRewriteKey(rewrite: RuntimePluginRewriteOptions | undefined): string {
  return `${rewrite?.nodeModulesRuntimeSpecifiers ?? true}:${rewrite?.nodeModulesBareSpecifiers ?? false}`
}

function createRuntimeModules(options?: SolidRuntimePluginSupportOptions): Record<string, RuntimeModuleEntry> {
  return {
    ...defaultRuntimeModules,
    ...(options?.additional ?? {}),
  }
}

function assertCompatibleInstall(
  install: RuntimePluginSupportInstall,
  modules: Record<string, RuntimeModuleEntry>,
  options?: SolidRuntimePluginSupportOptions,
): void {
  for (const specifier of Object.keys(modules)) {
    if (!install.specifiers.has(specifier)) {
      throw new Error(
        `AX TUI Solid runtime plugin support is already installed without ${specifier}. Call ensureRuntimePluginSupport({ additional }) from @defai-digital/ax-tui/solid/runtime-plugin-support/configure before importing @defai-digital/ax-tui/solid/runtime-plugin-support.`,
      )
    }
  }

  if (options?.core && options.core !== install.core) {
    throw new Error("AX TUI Solid runtime plugin support is already installed with a different core runtime module.")
  }

  if (options?.rewrite && normalizeRewriteKey(options.rewrite) !== install.rewriteKey) {
    throw new Error("AX TUI Solid runtime plugin support is already installed with different rewrite options.")
  }
}

export function ensureRuntimePluginSupport(options: SolidRuntimePluginSupportOptions = {}): boolean {
  const state = globalThis as RuntimePluginSupportState
  const modules = createRuntimeModules(options)
  const core = options.core ?? (coreRuntime as Record<string, unknown>)
  const rewriteKey = normalizeRewriteKey(options.rewrite)

  const install = state[runtimePluginSupportInstalledKey]
  if (install) {
    assertCompatibleInstall(install, modules, options)
    return false
  }

  ensureSolidTransformPlugin({
    moduleName: runtimeModuleIdForSpecifier("@defai-digital/ax-tui/solid"),
    resolvePath(specifier) {
      if (!isCoreRuntimeModuleSpecifier(specifier) && !modules[specifier]) {
        return null
      }

      return runtimeModuleIdForSpecifier(specifier)
    },
  })

  registerBunPlugin(
    createRuntimePlugin({
      core,
      additional: modules,
      rewrite: options.rewrite,
    }),
  )

  state[runtimePluginSupportInstalledKey] = {
    specifiers: new Set(Object.keys(modules)),
    core,
    rewriteKey,
  }
  return true
}
