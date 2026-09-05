import type { Hooks, PluginHookContext, PluginInput, Plugin as PluginInstance } from "@ax-code/plugin"
import { PRIVATE_GPU_AUTH_PLUGINS } from "../provider/private-gpu/auth-plugin"
import { Config } from "../config/config"
import { Bus } from "../bus"
import { Log } from "../util/log"
import { BunProc } from "../bun"
import { Session } from "../session"
import { Env } from "@/util/env"
import { fileURLToPath, pathToFileURL } from "url"
import { setMaxListeners } from "node:events"
import { Filesystem } from "@/util/filesystem"
import { Instance } from "@/project/instance"
import { Global } from "@/global"
import { RuntimeLocalClient } from "@/runtime/local-client"
import { PluginLifetime } from "./lifetime"
import { PluginData } from "./data"

export namespace Plugin {
  const log = Log.create({ service: "plugin" })
  type Entry = { hooks: Hooks; lifetime: PluginLifetime.Handle }
  type Store = {
    controller: AbortController
    entries: Entry[]
    lifetimes: Set<PluginLifetime.Handle>
    ready?: Promise<void>
    unsubscribe?: () => void
  }
  type TriggerName = Exclude<keyof Hooks, "event" | "config" | "auth" | "tool">

  const INTERNAL_PLUGINS: PluginInstance[] = [...PRIVATE_GPU_AUTH_PLUGINS]
  const DEPRECATED_PLUGIN_PACKAGES = ["ax-code-openai-codex-auth", "ax-code-copilot-auth"]

  function isFileUrl(value: string) {
    try {
      return new URL(value).protocol === "file:"
    } catch {
      return false
    }
  }

  function failure(phase: string, error: unknown) {
    // Plugin exceptions can embed prompts, credentials, or returned data.
    log.error(`plugin ${phase} hook failed`, {
      reason: PluginLifetime.Failure.isInstance(error) ? error.data.reason : "callback_error",
    })
  }

  async function dispose(current: Store) {
    current.controller.abort(PluginLifetime.disposed())
    current.unsubscribe?.()
    await Promise.all([...current.lifetimes].map((lifetime) => lifetime.dispose()))
    current.lifetimes.clear()
    current.entries.length = 0
  }

  function lifetime(current: Store) {
    const result = PluginLifetime.create(current.controller.signal, () => log.error("plugin cleanup failed"))
    current.lifetimes.add(result)
    return result
  }

  async function load(current: Store) {
    const signal = current.controller.signal
    const ctx = Instance.current
    const client = RuntimeLocalClient.create({ directory: ctx.directory })
    const cfg = await Config.get()
    signal.throwIfAborted()
    const input: PluginInput = {
      client,
      project: ctx.project,
      worktree: ctx.worktree,
      directory: ctx.directory,
      get serverUrl(): URL {
        return RuntimeLocalClient.url()
      },
      $: Bun.$.env(Env.sanitize(process.env)) as unknown as PluginInput["$"],
    }

    async function initialize(factory: PluginInstance) {
      signal.throwIfAborted()
      const owner = lifetime(current)
      try {
        // Preserve lazy serverUrl resolution while giving each factory its own lifetime.
        const pluginInput: PluginInput = Object.create(
          Object.getPrototypeOf(input),
          Object.getOwnPropertyDescriptors(input),
        )
        pluginInput.lifecycle = { signal: owner.signal, onDispose: owner.onDispose }
        const hooks = await owner.run(() => factory(pluginInput))
        signal.throwIfAborted()
        if (!hooks || typeof hooks !== "object") throw new Error("Plugin factory did not return hooks")
        current.entries.push({ hooks, lifetime: owner })
      } catch (error) {
        await owner.dispose()
        signal.throwIfAborted()
        failure("initialization", error)
      }
    }

    for (const plugin of INTERNAL_PLUGINS) await initialize(plugin)
    const plugins = cfg.plugin ?? []
    if (plugins.length) await Config.waitForDependencies()
    signal.throwIfAborted()

    for (let plugin of plugins) {
      signal.throwIfAborted()
      if (DEPRECATED_PLUGIN_PACKAGES.some((pkg) => plugin.includes(pkg))) continue
      const loader = lifetime(current)
      try {
        if (!isFileUrl(plugin)) {
          const idx = plugin.lastIndexOf("@")
          const pkg = idx > 0 ? plugin.substring(0, idx) : plugin
          const version = idx > 0 ? plugin.substring(idx + 1) : "latest"
          plugin = await loader.run(() => BunProc.install(pkg, version))
        } else {
          const pluginPath = fileURLToPath(plugin)
          const allowed =
            Filesystem.contains(Instance.directory, pluginPath) ||
            (Instance.worktree !== "/" && Filesystem.contains(Instance.worktree, pluginPath)) ||
            Filesystem.contains(Global.Path.config, pluginPath)
          if (!allowed) {
            Session.publishError({ message: "Refusing to load plugin outside trusted plugin directories" })
            continue
          }
          plugin = pathToFileURL(pluginPath).href
        }
        const mod: Record<string, unknown> = await loader.run(() => import(plugin))
        const seen = new Set<unknown>()
        for (const fn of Object.values(mod)) {
          if (typeof fn !== "function" || seen.has(fn)) continue
          seen.add(fn)
          await initialize(fn as PluginInstance)
        }
      } catch (error) {
        signal.throwIfAborted()
        failure("loading", error)
        Session.publishError({ message: "Failed to load plugin; check its installation and callback deadlines" })
      } finally {
        await loader.dispose()
        current.lifetimes.delete(loader)
      }
    }

    for (const entry of [...current.entries]) {
      if (!entry.hooks.config) continue
      const draft = PluginData.copy(cfg)
      try {
        await entry.lifetime.run((context) => entry.hooks.config!(draft, context))
        signal.throwIfAborted()
        entry.lifetime.signal.throwIfAborted()
        PluginData.commit(cfg, draft)
      } catch (error) {
        await entry.lifetime.dispose()
        signal.throwIfAborted()
        failure("config", error)
      }
    }
    signal.throwIfAborted()
    current.unsubscribe = Bus.subscribeAll(async (event) => {
      if (signal.aborted) return
      await Promise.all(
        current.entries.map(async (entry) => {
          if (!entry.hooks.event || entry.lifetime.signal.aborted) return
          try {
            const input = PluginData.copy({ event })
            await entry.lifetime.run((context) => entry.hooks.event!(input, context))
          } catch (error) {
            if (!signal.aborted) failure("event", error)
          }
        }),
      )
    })
  }

  // A synchronous store lets State.dispose abort an initializing plugin without
  // first awaiting that plugin's loading promise.
  const state = Instance.state(() => {
    const current: Store = {
      controller: new AbortController(),
      entries: [],
      lifetimes: new Set(),
    }
    setMaxListeners(0, current.controller.signal)
    return current
  }, dispose)

  async function loaded() {
    const current = state()
    current.controller.signal.throwIfAborted()
    current.ready ??= load(current).catch(async (error) => {
      await Promise.all([...current.lifetimes].map((owner) => owner.dispose()))
      current.entries.length = 0
      current.lifetimes.clear()
      // A transient Config/dependency failure can be retried in this instance.
      current.ready = undefined
      throw error
    })
    await PluginLifetime.wait(current.controller.signal, current.ready)
    current.controller.signal.throwIfAborted()
    return current
  }

  export async function trigger<
    Name extends TriggerName,
    Input = Parameters<Required<Hooks>[Name]>[0],
    Output = Parameters<Required<Hooks>[Name]>[1],
  >(name: Name, input: Input, output: Output): Promise<Output> {
    if (!name) return output
    const current = await loaded()
    const permission = name === "permission.ask" ? (output as { status: string }) : undefined
    let denied = permission?.status === "deny"
    let uncertain = false
    for (const entry of current.entries) {
      current.controller.signal.throwIfAborted()
      const fn = entry.hooks[name] as
        | ((input: Input, output: Output, context: PluginHookContext) => Promise<void>)
        | undefined
      if (!fn) continue
      if (entry.lifetime.signal.aborted) {
        // An unavailable permission participant remains uncertain on later
        // requests; retiring it must never make an approval easier to obtain.
        if (permission) {
          uncertain = true
          permission.status = denied ? "deny" : "ask"
        }
        continue
      }
      try {
        const draft = PluginData.copy(output)
        const detachedInput = PluginData.copy(input)
        await entry.lifetime.run((context) => fn(detachedInput, draft, context))
        current.controller.signal.throwIfAborted()
        entry.lifetime.signal.throwIfAborted()
        if (permission) {
          const decision = (draft as { status: string }).status
          if (!["ask", "deny", "allow"].includes(decision)) throw new Error("Invalid plugin permission status")
          denied ||= decision === "deny"
        }
        PluginData.commit(output, draft)
      } catch (error) {
        current.controller.signal.throwIfAborted()
        uncertain = true
        failure(name, error)
      }
      if (permission) permission.status = denied ? "deny" : uncertain ? "ask" : permission.status
    }
    return output
  }

  export async function list(): Promise<Hooks[]> {
    return (await loaded()).entries.filter((entry) => !entry.lifetime.signal.aborted).map((entry) => entry.hooks)
  }

  export async function init() {
    await loaded()
  }
}
