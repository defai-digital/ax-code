import type {
  Hooks,
  PluginHookContext,
  PluginInput,
  PluginPermissionAPI,
  PluginSessionAPI,
  Plugin as PluginInstance,
} from "@ax-code/plugin"
import { PRIVATE_GPU_AUTH_PLUGINS } from "../provider/private-gpu/auth-plugin"
import { Config } from "../config/config"
import { Bus } from "../bus"
import { Log } from "../util/log"
import { BunProc } from "../bun"
import { Session } from "../session"
import type { Permission } from "../permission"
import { Env } from "@/util/env"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "url"
import { setMaxListeners } from "node:events"
import { Filesystem } from "@/util/filesystem"
import { Instance } from "@/project/instance"
import { Global } from "@/global"
import { Flag } from "@/flag/flag"
import { RuntimeLocalClient } from "@/runtime/local-client"
import { PluginLifetime } from "./lifetime"
import { PluginData } from "./data"
import { isFileUrl } from "../util/file-url"
import { toErrorMessage } from "@/util/error-message"
import { SessionID, type SessionID as SessionIDType } from "@/session/schema"

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

  // ADR-244: build the per-plugin `permission.ask` and
  // `session.{create,compact,remove}` API. The plugin name bakes into the
  // session ownership marker so compact/remove can refuse cross-plugin
  // access. Internal plugins (no name) get the API but with an empty
  // identity — they are part of the host and are not name-restricted.
  async function checkSessionOwnership(
    sessionID: string,
    pluginName: string | undefined,
  ): Promise<{ ok: true; info: Session.Info } | { ok: false; error: string }> {
    if (!pluginName) {
      // Internal plugins are part of the host and may administer any
      // session in the active project. The project boundary is still
      // enforced (the session must belong to `Instance.project`).
      const info = await Session.get(sessionID as SessionID).catch((error: unknown) => {
        return toErrorMessage(error)
      })
      if (typeof info === "string") return { ok: false, error: info }
      if (!info) return { ok: false, error: `Session not found: ${sessionID}` }
      if (info.projectID !== Instance.project.id) {
        return { ok: false, error: "Session does not belong to the active project" }
      }
      return { ok: true, info }
    }
    const info = await Session.get(sessionID as SessionID).catch((error: unknown) => {
      return toErrorMessage(error)
    })
    if (typeof info === "string") return { ok: false, error: info }
    if (!info) return { ok: false, error: `Session not found: ${sessionID}` }
    if (info.projectID !== Instance.project.id) {
      return { ok: false, error: "Session does not belong to the active project" }
    }
    const cfg = await Config.get()
    const trusted = cfg.plugin_trust?.session_admin?.includes(pluginName) === true
    if (trusted) return { ok: true, info }
    const owner =
      info.metadata && typeof info.metadata === "object"
        ? (info.metadata as Record<string, unknown>).createdByPlugin
        : undefined
    if (owner === pluginName) return { ok: true, info }
    return {
      ok: false,
      error: "Session is not owned by this plugin and the plugin is not in plugin_trust.session_admin",
    }
  }

  function createPluginCapabilityAPI(
    owner: PluginLifetime.Handle,
    pluginName: string | undefined,
  ): { permission: PluginPermissionAPI; session: PluginSessionAPI } {
    const permission: PluginPermissionAPI = {
      async ask(input) {
        try {
          // Lazy: a static import would load permission/ and session/ in a cycle.
          const { Permission: PermissionRuntime } = await import("../permission")
          const config = await Config.get()
          // A plugin may only ask in its own namespace. Letting it name a core
          // permission ("bash", "edit", ...) together with "always" would let it
          // plant persistent grants for the host's permissions.
          const permissionName = input.permission.startsWith("plugin:")
            ? input.permission
            : `plugin:${input.permission}`
          // Detach the patterns + metadata so plugin code cannot mutate host
          // state by accident. The effective configured rules (user, trusted
          // project, managed) are evaluated first, so a configured deny or a
          // managed deny wins over any prompt or earlier grant.
          const draft = {
            sessionID: SessionID.descending(),
            permission: permissionName,
            patterns: [...input.patterns],
            metadata: { ...(input.metadata ?? {}), plugin: pluginName },
            always: [] as string[],
            ruleset: PermissionRuntime.fromConfig(config.permission ?? {}) as Permission.Ruleset,
            agent: undefined as string | undefined,
          }
          await owner.run(() => PermissionRuntime.ask(draft))
          return { ok: true, status: "allow" as const }
        } catch (error) {
          // The runtime's permission pipeline throws `DeniedError`,
          // `RejectedError` or `CorrectedError` (a reject with feedback,
          // which stays private to the user) for negative outcomes; all map
          // to `deny`. Anything else is an infrastructure failure and
          // reports `ok: false` so the plugin can react.
          const name = error && typeof error === "object" ? (error as { name?: unknown }).name : undefined
          if (
            name === "PermissionDeniedError" ||
            name === "PermissionRejectedError" ||
            name === "PermissionCorrectedError"
          ) {
            return { ok: true, status: "deny" as const }
          }
          return { ok: false, error: toErrorMessage(error) }
        }
      },
    }

    const session: PluginSessionAPI = {
      async create(input) {
        try {
          // A parent must be a session this plugin may administer: otherwise a
          // plugin could hang a child under someone else's session and later
          // have it deleted or compacted with that session.
          if (input.parentID) {
            const parent = await checkSessionOwnership(input.parentID, pluginName)
            if (!parent.ok) return parent
          }
          // Tag the session with the plugin's name. `Session.create` does
          // not accept metadata today, so we create then update. The
          // window between the two writes is owned by the runtime, not
          // user code, and is not exposed via any list API before the
          // update lands.
          const created = await owner.run(() =>
            Session.create({
              ...(input.parentID ? { parentID: input.parentID as SessionID } : {}),
              ...(input.title ? { title: input.title } : {}),
            }),
          )
          if (pluginName) {
            await owner
              .run(() =>
                Session.setMetadata({
                  sessionID: created.id,
                  metadata: { createdByPlugin: pluginName },
                }),
              )
              .catch(async (error) => {
                // Untagged, the session would be one this plugin can never
                // compact or remove again, so undo the create.
                await Session.remove(created.id).catch((removeError) =>
                  log.warn("failed to remove untagged plugin session", { sessionID: created.id, error: removeError }),
                )
                throw error
              })
          }
          return { ok: true, sessionID: created.id }
        } catch (error) {
          return { ok: false, error: toErrorMessage(error) }
        }
      },
      async compact(sessionID) {
        const check = await checkSessionOwnership(sessionID, pluginName)
        if (!check.ok) return check
        try {
          // Use the project default model and the build agent (the
          // default primary agent) so the compaction is consistent with
          // what the runtime would do for a normal session.
          // Lazy for the same reason as the permission import above.
          const { Provider } = await import("../provider/provider")
          const { SessionCompaction } = await import("../session/compaction")
          const model = await owner.run(() => Provider.defaultModel())
          await owner.run(() =>
            SessionCompaction.create({
              sessionID: check.info.id,
              agent: "build",
              model,
              auto: false,
              triggerReason: "manual",
            }),
          )
          return { ok: true }
        } catch (error) {
          return { ok: false, error: toErrorMessage(error) }
        }
      },
      async remove(sessionID) {
        const check = await checkSessionOwnership(sessionID, pluginName)
        if (!check.ok) return check
        try {
          // Session.remove deletes the whole subtree, so every descendant must
          // be administrable too, not just the root. Bounded walk; anything
          // foreign (or an oversized tree) refuses the whole removal.
          const queue: string[] = [check.info.id]
          for (let visited = 0; queue.length > 0; visited++) {
            if (visited >= 500)
              return { ok: false, error: "Session tree is too large to remove through the plugin API" }
            const children = await owner.run(() => Session.children(queue.shift() as SessionID))
            for (const child of children) {
              const childCheck = await checkSessionOwnership(child.id, pluginName)
              if (!childCheck.ok) {
                return { ok: false, error: "Session tree contains a session this plugin does not own" }
              }
              queue.push(child.id)
            }
          }
          const cfg = await Config.get()
          const trusted = !pluginName || cfg.plugin_trust?.session_admin?.includes(pluginName) === true
          await owner.run(() =>
            Session.remove(
              check.info.id,
              (subtree) =>
                subtree.length <= 500 &&
                subtree.every(
                  (session) =>
                    session.projectID === Instance.project.id &&
                    (trusted || session.metadata?.createdByPlugin === pluginName),
                ),
            ),
          )
          return { ok: true }
        } catch (error) {
          return { ok: false, error: toErrorMessage(error) }
        }
      },
    }

    return { permission, session }
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

    async function initialize(factory: PluginInstance, pluginName?: string) {
      signal.throwIfAborted()
      const owner = lifetime(current)
      try {
        // Preserve lazy serverUrl resolution while giving each factory its own lifetime.
        const pluginInput: PluginInput = Object.create(
          Object.getPrototypeOf(input),
          Object.getOwnPropertyDescriptors(input),
        )
        pluginInput.lifecycle = { signal: owner.signal, onDispose: owner.onDispose }
        // ADR-244: hand the plugin its permission / session API with the
        // plugin's identity baked in. Plugins that ignore the new API
        // are unaffected — the fields are optional in the type.
        if (pluginName !== undefined) {
          const api = createPluginCapabilityAPI(owner, pluginName)
          pluginInput.permission = api.permission
          pluginInput.session = api.session
        }
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
      // Capture the original spec so the plugin name (used by ADR-244's
      // session ownership marker and the trust-list config) matches what
      // the user wrote in `cfg.plugin`, not the resolved install path.
      const pluginName = plugin
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
            Filesystem.contains(Global.Path.config, pluginPath) ||
            // Config discovery trusts the global ~/.ax-code and AX_CODE_CONFIG_DIR plugin directories too.
            Filesystem.contains(path.join(Global.Path.home, ".ax-code"), pluginPath) ||
            (!!Flag.AX_CODE_CONFIG_DIR && Filesystem.contains(Flag.AX_CODE_CONFIG_DIR, pluginPath))
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
          await initialize(fn as PluginInstance, pluginName)
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
        // The runtime Config can be strictly wider than the generated SDK
        // `Config` a plugin hook declares (e.g. the ADR-232 `isolation.network`
        // allowlist object). The hook only narrows the config, so pass the same
        // data through the SDK-facing type rather than widening the generated
        // contract, which must stay byte-identical until the SDK regenerates.
        const hookConfig = draft as Parameters<NonNullable<Hooks["config"]>>[0]
        await entry.lifetime.run((context) => entry.hooks.config!(hookConfig, context))
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
