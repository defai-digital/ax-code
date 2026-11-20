/**
 * SolidJS build and runtime integration for AX TUI.
 *
 * @module
 */
export {}
import { plugin as registerBunPlugin, type BunPlugin } from "bun"
import { stripQueryAndHash, transformSolidSource, type ResolveImportPath } from "./solid-transform.js"

const solidTransformStateKey = Symbol.for("ax-code.tui.solid.transform")

type SolidTransformRuntime = {
  moduleName?: string
  resolvePath?: ResolveImportPath
}

type SolidTransformState = {
  installed: boolean
  runtime?: SolidTransformRuntime
}

type GlobalSolidTransformState = typeof globalThis & {
  [solidTransformStateKey]?: SolidTransformState
}

export interface CreateSolidTransformPluginOptions {
  moduleName?: string
  resolvePath?: ResolveImportPath
}

const getSolidTransformState = (): SolidTransformState => {
  const state = globalThis as GlobalSolidTransformState
  state[solidTransformStateKey] ??= { installed: false }
  return state[solidTransformStateKey]
}

const getSolidTransformRuntime = (): SolidTransformRuntime => {
  return getSolidTransformState().runtime ?? {}
}

const hasSolidTransformRuntime = (input: CreateSolidTransformPluginOptions): boolean => {
  return input.moduleName !== undefined || input.resolvePath !== undefined
}

export function ensureSolidTransformPlugin(input: CreateSolidTransformPluginOptions = {}): boolean {
  const state = getSolidTransformState()

  if (hasSolidTransformRuntime(input)) {
    state.runtime = {
      moduleName: input.moduleName,
      resolvePath: input.resolvePath,
    }
  }

  if (state.installed) {
    return false
  }

  // The filter is wide regardless of configuration, so the registered plugin
  // needs no input closure: all ensure-time configuration lives in the
  // runtime state (refreshed on every call, cleared on reset), and leaving
  // the closure empty keeps a later reset from resurrecting removed values.
  registerBunPlugin(createSolidTransformPlugin())
  state.installed = true
  return true
}

export function resetSolidTransformPluginState(): void {
  const state = getSolidTransformState()
  state.installed = false
  delete state.runtime
}

export function createSolidTransformPlugin(input: CreateSolidTransformPluginOptions = {}): BunPlugin {
  // Always register the wide filter: whether imports need rewriting is decided
  // per load from the current runtime (below), and a filter fixed at
  // registration cannot be widened when a resolvePath is configured after the
  // plugin was installed (e.g. preload.ts installs it with no arguments long
  // before ensureRuntimePluginSupport provides the resolvePath).
  const sourceFilter = /^(?!.*[/\\]node_modules[/\\]).*\.[cm]?[jt]sx?(?:[?#].*)?$/

  return {
    name: "bun-plugin-solid",
    setup: (build) => {
      build.onLoad({ filter: /[/\\]node_modules[/\\]solid-js[/\\]dist[/\\]server\.js(?:[?#].*)?$/ }, async (args) => {
        const path = stripQueryAndHash(args.path).replace("server.js", "solid.js")
        const file = Bun.file(path)
        const code = await file.text()
        return { contents: code, loader: "js" }
      })

      build.onLoad(
        { filter: /[/\\]node_modules[/\\]solid-js[/\\]store[/\\]dist[/\\]server\.js(?:[?#].*)?$/ },
        async (args) => {
          const path = stripQueryAndHash(args.path).replace("server.js", "store.js")
          const file = Bun.file(path)
          const code = await file.text()
          return { contents: code, loader: "js" }
        },
      )

      build.onLoad({ filter: sourceFilter }, async (args) => {
        const path = stripQueryAndHash(args.path)

        const file = Bun.file(path)
        const code = await file.text()
        // Input passed directly to createSolidTransformPlugin (only possible
        // for standalone constructions — ensure registers an empty closure)
        // wins per field; the runtime state fills the rest.
        const runtime = getSolidTransformRuntime()
        const moduleName = input.moduleName ?? runtime.moduleName ?? "@defai-digital/ax-tui/solid"
        const resolvePath = input.resolvePath ?? runtime.resolvePath
        // Without a resolvePath there is nothing to rewrite and (for non-JSX
        // files) no JSX to strip; hand the file to Bun's native loader
        // unchanged. Babel's module-strict parse is not equivalent to Bun's
        // native TS/JS handling (CJS top-level return, sloppy mode,
        // decorators).
        if (!resolvePath && !/\.[cm]?[jt]sx$/.test(path)) {
          return { contents: code, loader: /\.[cm]?ts$/.test(path) ? "ts" : "js" }
        }
        const contents = await transformSolidSource(code, {
          filename: path,
          moduleName,
          resolvePath,
        })

        return {
          contents,
          loader: "js",
        }
      })
    },
  }
}

const solidTransformPlugin = createSolidTransformPlugin()

export default solidTransformPlugin
