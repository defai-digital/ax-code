import z from "zod"

const inventory = [
  {
    name: "Project.fromDirectory",
    kind: "resolver",
    module: "src/project/project.ts",
    owner: "Instance.provide",
    triggers: ["startup", "workspace_switch", "reload"],
    dependencyMode: "promise",
    phase0Action: "observe_only",
    notes: "Project discovery now uses a Promise-based bootstrap path without the Effect service runtime.",
  },
  {
    name: "Format.init",
    kind: "service",
    module: "src/format/index.ts",
    owner: "InstanceBootstrap",
    triggers: ["startup", "reload"],
    dependencyMode: "promise",
    phase0Action: "observe_only",
    notes: "Formatter lifecycle now uses Instance.state while preserving eager bootstrap behavior.",
  },
  {
    name: "Plugin.init",
    kind: "service",
    module: "src/plugin/index.ts",
    owner: "InstanceBootstrap",
    triggers: ["startup", "reload"],
    dependencyMode: "promise",
    phase0Action: "observe_only",
    notes: "Plugin loading now runs through Promise state with explicit bus subscription cleanup.",
  },
  {
    name: "LSP.init",
    kind: "service",
    module: "src/lsp/index.ts",
    owner: "InstanceBootstrap",
    triggers: ["startup", "reload"],
    dependencyMode: "promise",
    phase0Action: "observe_only",
    notes: "Already uses the Instance state helper rather than Effect-managed runtime services.",
  },
  {
    name: "Provider.warmup",
    kind: "task",
    module: "src/provider/provider.ts",
    owner: "InstanceBootstrap",
    triggers: ["startup"],
    dependencyMode: "promise",
    phase0Action: "observe_only",
    notes: "Background warmup begins during bootstrap so the first prompt does not block on provider loading.",
  },
  {
    name: "File.init",
    kind: "service",
    module: "src/file/index.ts",
    owner: "InstanceBootstrap",
    triggers: ["startup", "reload"],
    dependencyMode: "promise",
    phase0Action: "observe_only",
    notes: "File cache warmup and search lifecycle now use Promise state without Effect fibers.",
  },
  {
    name: "FileWatcher.init",
    kind: "service",
    module: "src/file/watcher.ts",
    owner: "InstanceBootstrap",
    triggers: ["startup", "reload"],
    dependencyMode: "promise",
    phase0Action: "observe_only",
    notes: "File watcher lifecycle now uses Instance.state with explicit cleanup hooks per directory.",
  },
  {
    name: "Vcs.init",
    kind: "service",
    module: "src/project/vcs.ts",
    owner: "InstanceBootstrap",
    triggers: ["startup", "reload"],
    dependencyMode: "promise",
    phase0Action: "observe_only",
    notes: "VCS branch tracking now uses Instance.state and watcher subscriptions without Effect-managed runtime state.",
  },
  {
    name: "Snapshot.init",
    kind: "service",
    module: "src/snapshot/index.ts",
    owner: "InstanceBootstrap",
    triggers: ["startup", "reload"],
    dependencyMode: "promise",
    phase0Action: "observe_only",
    notes: "Snapshot tracking and cleanup scheduling now run through Promise state with explicit timers.",
  },
  {
    name: "Session.pruneExpired",
    kind: "task",
    module: "src/session/index.ts",
    owner: "InstanceBootstrap",
    triggers: ["startup"],
    dependencyMode: "promise",
    phase0Action: "observe_only",
    notes: "Optional startup background cleanup task when session auto-prune is enabled.",
  },
  {
    name: "SessionStatus.service",
    kind: "service",
    module: "src/session/status.ts",
    owner: "session and server live-update flows",
    triggers: ["live_update"],
    dependencyMode: "promise",
    phase0Action: "observe_only",
    notes: "Session status is now stored in per-instance Promise state while preserving bus events.",
  },
  {
    name: "Permission.requests",
    kind: "service",
    module: "src/permission/index.ts",
    owner: "session and TUI blocking flows",
    triggers: ["startup", "live_update"],
    dependencyMode: "promise",
    phase0Action: "observe_only",
    notes: "Permission request tracking now shares a Promise state path for public APIs and legacy Effect wrappers.",
  },
  {
    name: "Question.requests",
    kind: "service",
    module: "src/question/index.ts",
    owner: "session and TUI blocking flows",
    triggers: ["startup", "live_update"],
    dependencyMode: "promise",
    phase0Action: "observe_only",
    notes: "Question request tracking now uses per-instance Promise state while retaining the legacy service wrapper.",
  },
  {
    name: "disposeInstance",
    kind: "disposer",
    module: "src/effect/instance-registry.ts",
    owner: "Instance.reload / Instance.dispose / Instance.disposeAll",
    triggers: ["workspace_switch", "reload", "shutdown"],
    dependencyMode: "promise",
    phase0Action: "observe_only",
    notes: "Reload and shutdown call registered disposers through Promise cleanup hooks without Effect-managed disposal.",
  },
] as const

export namespace RuntimeHotPath {
  export const Trigger = z
    .enum(["startup", "live_update", "workspace_switch", "reload", "shutdown"])
    .describe("Lifecycle trigger that places the component on the interactive hot path")
  export type Trigger = z.infer<typeof Trigger>

  export const Kind = z
    .enum(["service", "task", "resolver", "disposer"])
    .describe("Phase 0 inventory classification for a hot-path component")
  export type Kind = z.infer<typeof Kind>

  export const DependencyMode = z
    .enum(["effect_managed", "promise", "mixed"])
    .describe("Current execution model for the hot-path component")
  export type DependencyMode = z.infer<typeof DependencyMode>

  export const Phase0Action = z
    .enum(["migrate_off_effect", "observe_only", "remove_from_hot_path"])
    .describe("Planned Phase 0 handling strategy for the hot-path component")
  export type Phase0Action = z.infer<typeof Phase0Action>

  export const Entry = z
    .object({
      name: z.string().min(1).describe("Stable hot-path component name"),
      kind: Kind.describe("Hot-path component classification"),
      module: z.string().min(1).describe("Owning module path relative to packages/ax-code"),
      owner: z.string().min(1).describe("Lifecycle owner or entrypoint that activates the component"),
      triggers: z.array(Trigger).min(1).describe("Lifecycle triggers that include the component"),
      dependencyMode: DependencyMode.describe("Current execution model for the component"),
      phase0Action: Phase0Action.describe("Phase 0 action planned for the component"),
      notes: z.string().optional().describe("Short Phase 0 note for migration or observation"),
    })
    .strict()
  export type Entry = z.infer<typeof Entry>

  const parsed = z.array(Entry).parse(inventory)

  export function list(): Entry[] {
    return parsed.map((item) => ({
      ...item,
      triggers: [...item.triggers],
    }))
  }

  export function get(name: string): Entry | undefined {
    const item = parsed.find((entry) => entry.name === name)
    if (!item) return
    return {
      ...item,
      triggers: [...item.triggers],
    }
  }
}
