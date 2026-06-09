import type { Hooks, PluginInput, Plugin as PluginInstance } from "@ax-code/plugin"
import { xaiAuthPlugin } from "../provider/xai/auth-plugin"
import { Config } from "../config/config"
import { Bus } from "../bus"
import { Log } from "../util/log"
import { BunProc } from "../bun"
import { Session } from "../session"
import { NamedError } from "@ax-code/util/error"
import { Env } from "@/util/env"
import { fileURLToPath } from "url"
import { withTimeout } from "@/util/timeout"
import { Filesystem } from "@/util/filesystem"
import { Instance } from "@/project/instance"
import { Global } from "@/global"
import { toErrorMessage } from "../util/error-message"
import { RuntimeLocalClient } from "@/runtime/local-client"

export namespace Plugin {
  const log = Log.create({ service: "plugin" })

  type State = {
    hooks: Hooks[]
    unsubscribe: () => void
  }

  // Hook names that follow the (input, output) => Promise<void> trigger pattern
  type TriggerName = {
    [K in keyof Hooks]-?: NonNullable<Hooks[K]> extends (input: any, output: any) => Promise<void> ? K : never
  }[keyof Hooks]

  // Built-in plugins that are directly imported (not installed from npm)
  const INTERNAL_PLUGINS: PluginInstance[] = [xaiAuthPlugin]

  // Old npm package names for plugins that are now built-in — skip if users still have them in config
  const DEPRECATED_PLUGIN_PACKAGES = ["ax-code-openai-codex-auth", "ax-code-copilot-auth"]

  const state = Instance.state(
    async () => {
      const hooks: Hooks[] = []
      const ctx = Instance.current
      const client = RuntimeLocalClient.create({ directory: ctx.directory })
      const cfg = await Config.get()
      const input: PluginInput = {
        client,
        project: ctx.project,
        worktree: ctx.worktree,
        directory: ctx.directory,
        get serverUrl(): URL {
          return RuntimeLocalClient.url()
        },
        $: Bun.$.env(Env.sanitize(process.env)),
      }

      for (const plugin of INTERNAL_PLUGINS) {
        log.info("loading internal plugin", { name: plugin.name })
        const init = await plugin(input).catch((err) => {
          log.error("failed to load internal plugin", { name: plugin.name, error: err })
        })
        if (init) hooks.push(init)
      }

      let plugins = cfg.plugin ?? []
      if (plugins.length) await Config.waitForDependencies()

      for (let plugin of plugins) {
        if (DEPRECATED_PLUGIN_PACKAGES.some((pkg) => plugin.includes(pkg))) continue
        log.info("loading plugin", { path: plugin })
        if (!plugin.startsWith("file://")) {
          const idx = plugin.lastIndexOf("@")
          const pkg = idx > 0 ? plugin.substring(0, idx) : plugin
          const version = idx > 0 ? plugin.substring(idx + 1) : "latest"
          plugin = await BunProc.install(pkg, version).catch((err) => {
            const detail = toErrorMessage((err as { cause?: unknown }).cause ?? err)
            log.error("failed to install plugin", { pkg, version, error: detail })
            Session.publishError({
              message: `Failed to install plugin ${pkg}@${version}: ${detail}`,
            })
            return ""
          })
          if (!plugin) continue
        } else {
          const pluginPath = fileURLToPath(plugin)
          const allowed =
            Filesystem.contains(Instance.directory, pluginPath) ||
            (Instance.worktree !== "/" && Filesystem.contains(Instance.worktree, pluginPath)) ||
            Filesystem.contains(Global.Path.config, pluginPath)
          if (!allowed) {
            const message = `Refusing to load plugin outside trusted plugin directories: ${pluginPath}`
            log.error("blocked plugin outside trusted directories", { pluginPath })
            Session.publishError({ message })
            continue
          }
        }

        await withTimeout(import(plugin), 15_000, `loading plugin timed out: ${plugin}`)
          .then(async (mod) => {
            const seen = new Set<PluginInstance>()
            for (const [_name, fn] of Object.entries<PluginInstance>(mod)) {
              if (seen.has(fn)) continue
              seen.add(fn)
              hooks.push(await fn(input))
            }
          })
          .catch((err) => {
            const message = NamedError.message(err)
            log.error("failed to load plugin", { path: plugin, error: message })
            Session.publishError({ message: `Failed to load plugin ${plugin}: ${message}` })
          })
      }

      // Iterate a snapshot: a failing hook is spliced out of `hooks`, and
      // mutating the array being iterated by `for...of` would skip the hook
      // immediately after the failed one.
      for (const hook of [...hooks]) {
        try {
          const config = (hook as any).config
          await config?.(cfg)
        } catch (err) {
          const index = hooks.indexOf(hook)
          if (index !== -1) hooks.splice(index, 1)
          log.error("plugin config hook failed", { error: err })
        }
      }

      const unsubscribe = Bus.subscribeAll(async (event) => {
        for (const hook of hooks) {
          hook["event"]?.({ event })
        }
      })

      return { hooks, unsubscribe } satisfies State
    },
    async (entry) => {
      entry.unsubscribe()
    },
  )

  export async function trigger<
    Name extends TriggerName,
    Input = Parameters<Required<Hooks>[Name]>[0],
    Output = Parameters<Required<Hooks>[Name]>[1],
  >(name: Name, input: Input, output: Output): Promise<Output> {
    if (!name) return output
    const current = await state()
    for (const hook of current.hooks) {
      const fn = hook[name] as any
      if (!fn) continue
      await fn(input, output)
    }
    return output
  }

  export async function list(): Promise<Hooks[]> {
    return (await state()).hooks
  }

  export async function init() {
    await state()
  }
}
