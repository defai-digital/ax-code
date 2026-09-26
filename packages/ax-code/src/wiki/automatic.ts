import { Log } from "../util/log"
import path from "node:path"
import os from "node:os"
import { realpath } from "node:fs/promises"
import { WikiMaintenanceSchema } from "./maintenance-schema"
import { GlobalBus } from "../bus/global"
import { Instance } from "../project/instance"
import { Agent } from "../agent/agent"
import { Permission } from "../permission"
import { SessionStatus } from "../session/status"
import { TaskQueue } from "../session/task-queue"
import { FileWatcher } from "../file/watcher"
import { getWikiStatus } from "@ax-code/ax-wiki"
import { createWikiIdleController } from "./idle-controller"
import { resolveWikiRuntimeConfig, engineConfig } from "./config"
import { runNativeWiki } from "./native"
import { wikiProjectRoot } from "./root"

export namespace WikiAutomatic {
  export const Status = WikiMaintenanceSchema
  type Owner = {
    run<T>(fn: () => Promise<T>): Promise<T>
    directory: string
    agent: string
    active: boolean
    idle(): Promise<boolean>
    rules(): Promise<Permission.Ruleset>
  }
  type Entry = {
    root: string
    dir: string
    owners: Map<string, Owner>
    busy: Map<string, string>
    controller: ReturnType<typeof createWikiIdleController>
  }
  const entries = new Map<string, Entry>()
  const state = Instance.state(
    () => ({ entry: undefined as Entry | undefined, generation: 0, disposed: false }),
    async (state) => {
      state.disposed = true
      state.generation++
      const entry = state.entry
      if (!entry) return
      entry.controller.activity()
      entry.owners.delete(Instance.directory)
      if (entry.owners.size) {
        entry.controller.activity()
        return
      }
      if (entries.get(JSON.stringify([entry.root, entry.dir])) === entry)
        entries.delete(JSON.stringify([entry.root, entry.dir]))
      await entry.controller.dispose()
    },
  )
  function contains(root: string, file: string) {
    const relative = path.relative(root, file)
    return relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative))
  }
  async function attach(agent: string, active = false) {
    const scope = state()
    const ticket = ++scope.generation
    const root = await wikiProjectRoot()
    const config = await resolveWikiRuntimeConfig()
    const home = await realpath(os.homedir())
    if (root === home || root === path.parse(root).root)
      throw new Error("Wiki maintenance is unavailable for this directory")
    await Agent.get(agent)
    if (scope.disposed || ticket !== scope.generation) return undefined
    const owner: Owner = {
      directory: Instance.directory,
      agent,
      active,
      run: Instance.bind(async (fn) => fn()),
      idle: Instance.bind(
        async () =>
          !owner.active &&
          (await SessionStatus.list()).size === 0 &&
          (
            await TaskQueue.list({
              statuses: ["queued", "waiting_for_idle", "running", "blocked_permission", "blocked_question"],
            })
          ).filter((item) => contains(root, item.directory) || item.directory === owner.directory).length === 0,
      ),
      rules: Instance.bind(async () => (await Agent.get(owner.agent)).permission),
    }
    const key = JSON.stringify([root, config.dir])
    const existing = scope.entry
    if (existing && JSON.stringify([existing.root, existing.dir]) !== key) {
      existing.controller.activity()
      existing.owners.delete(Instance.directory)
      scope.entry = undefined
      if (!existing.owners.size) {
        if (entries.get(JSON.stringify([existing.root, existing.dir])) === existing)
          entries.delete(JSON.stringify([existing.root, existing.dir]))
        await existing.controller.dispose()
      }
      if (scope.disposed || ticket !== scope.generation) return undefined
    }
    let entry = entries.get(key)
    if (!entry) {
      const owners = new Map<string, Owner>()
      const git = Instance.project.vcs === "git"
      const busy = new Map<string, string>()
      const context = async () => {
        const selected = owners.values().next().value
        if (!selected) throw new Error("Wiki maintenance has no active owner")
        const cfg = await selected.run(() => resolveWikiRuntimeConfig())
        const rules = await Promise.all([...owners.values()].map((item) => item.rules()))
        const allowed = (permission: string, relative: string) =>
          rules.length > 0 &&
          rules.every(
            (set) =>
              Permission.evaluate(permission, path.join(root, relative), set).action === "allow" &&
              Permission.evaluate(permission, relative, set).action === "allow",
          )
        return { cfg, allowed }
      }
      const controller = createWikiIdleController({
        onError: (error) =>
          Log.Default.warn("Wiki background maintenance failed", {
            failure: error instanceof Error ? error.name : "UnknownError",
          }),
        policy: async () => {
          const { cfg, allowed } = await context()
          return {
            enabled: cfg.enabled,
            automatic: cfg.auto,
            writable: allowed("edit", `${cfg.dir}/quickstart.md`) && allowed("read", `${cfg.dir}/.manifest.json`),
            git,
          }
        },
        idle: async () =>
          busy.size === 0 && (await Promise.all([...owners.values()].map((item) => item.idle()))).every(Boolean),
        build: async (signal, progress) => {
          const { cfg, allowed } = await context()
          signal.throwIfAborted()
          const status = await getWikiStatus({
            root,
            wikiDir: cfg.dir,
            config: engineConfig(cfg),
            signal,
            allowSource: (relative) => allowed("read", relative),
          })
          signal.throwIfAborted()
          if (status.healthy && status.freshness === "fresh") return
          const selected = owners.values().next().value
          if (!selected) throw new Error("Wiki maintenance has no active owner")
          await selected.run(() =>
            runNativeWiki({
              root,
              dir: cfg.dir,
              action: status.healthy ? "update" : "generate",
              signal,
              lockTimeoutMs: 100,
              includeGraphEvidence: false,
              allowSource: (relative) => allowed("read", relative),
              allowWrite: (relative) => allowed("edit", relative),
              onProgress: progress,
            }),
          )
        },
      })
      entry = { root, dir: config.dir, owners, busy, controller }
      entries.set(key, entry)
    }
    const previous = entry.owners.get(Instance.directory)
    entry.owners.set(Instance.directory, owner)
    scope.entry = entry
    if (!previous || previous.agent !== agent || previous.active !== active) entry.controller.activity()
    return entry
  }
  /** Only explicit interactive registration or refresh enables maintenance. */
  export async function enable(agent: string, active = false) {
    return (
      (await attach(agent, active))?.controller.status() ?? {
        phase: "disabled" as const,
        reason: "disabled" as const,
        completed: 0,
        total: 0,
        revision: 0,
      }
    )
  }
  export async function refresh(agent: string, active?: boolean) {
    const previous = state().entry?.owners.get(Instance.directory)
    const entry = await attach(agent, active ?? previous?.active ?? false)
    entry?.controller.request()
    return (
      entry?.controller.status() ?? {
        phase: "disabled" as const,
        reason: "disabled" as const,
        completed: 0,
        total: 0,
        revision: 0,
      }
    )
  }
  export function status() {
    return (
      state().entry?.controller.status() ?? {
        phase: "disabled" as const,
        reason: "disabled" as const,
        completed: 0,
        total: 0,
        revision: 0,
      }
    )
  }
  GlobalBus.on("event", (event) => {
    for (const entry of entries.values()) {
      if (!event.directory || (!contains(entry.root, event.directory) && !entry.owners.has(event.directory))) continue
      if (event.payload.type === SessionStatus.Event.Status.type) {
        if (event.payload.properties.status.type === "idle") entry.busy.delete(event.payload.properties.sessionID)
        else entry.busy.set(event.payload.properties.sessionID, event.directory)
        entry.controller.activity()
      }
      if (event.payload.type.startsWith("task.queue.")) entry.controller.activity()
      if (event.payload.type === "session.deleted") {
        entry.busy.delete(event.payload.properties.info.id)
        entry.controller.activity()
      }
      if (event.payload.type === "server.instance.disposed") {
        for (const [id, directory] of entry.busy) if (directory === event.directory) entry.busy.delete(id)
        entry.controller.activity()
      }
      if (event.payload.type === FileWatcher.Event.Updated.type) {
        const file = event.payload.properties.file
        if (
          typeof file === "string" &&
          !contains(path.join(entry.root, entry.dir), path.resolve(event.directory, file))
        )
          entry.controller.changed()
      }
    }
  })
}
