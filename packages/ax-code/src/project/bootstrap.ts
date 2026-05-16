import { Plugin } from "../plugin"
import { Format } from "../format"
import { LSP } from "../lsp"
import { File } from "../file"
import { FileWatcher } from "../file/watcher"
import { Snapshot } from "../snapshot"
import { Project } from "./project"
import { Vcs } from "./vcs"
import { Bus } from "../bus"
import { Command } from "../command"
import { Instance } from "./instance"
import { Log } from "@/util/log"
import { ShareNext } from "@/share/share-next"
import { Config } from "../config/config"
import { Session } from "../session"
import { Provider } from "../provider/provider"
import { isHarmlessEffectInterrupt } from "@/effect/interrupt"
import {
  BOOTSTRAP_PREWARM_MAX_FILES,
  BOOTSTRAP_PREWARM_MAX_LANGUAGES,
  BOOTSTRAP_PREWARM_TIMEOUT_MS,
  INDEXER_SEMANTIC_METHODS,
} from "../lsp/prewarm-profile"

const BOOTSTRAP_TIMEOUT_MS = 30_000

function fireAndForget(label: string, task: () => Promise<unknown> | unknown) {
  const handle = (err: unknown) => {
    if (isHarmlessEffectInterrupt(err)) return
    Log.Default.warn(`${label} failed`, {
      error: err instanceof Error ? err.message : String(err),
    })
  }
  try {
    Promise.resolve(task()).catch(handle)
  } catch (err) {
    handle(err)
  }
}

function runtimeTask(input: {
  service: string
  label: string
  timeoutMs?: number
  task: (signal: AbortSignal) => Promise<unknown> | unknown
}) {
  return Instance.runtime().track({
    service: input.service,
    label: input.label,
    timeoutMs: input.timeoutMs ?? BOOTSTRAP_TIMEOUT_MS,
    task: input.task,
    onFailure: Instance.bind(() => {
      Instance.runtimeSnapshot({
        trigger: "service_failure",
        failureClass: "service_bootstrap",
      })
    }),
    onTimeout: Instance.bind(() => {
      Instance.runtimeSnapshot({
        trigger: "timeout",
        failureClass: "service_bootstrap",
      })
    }),
  })
}

function background(input: {
  service: string
  label: string
  timeoutMs?: number
  task: () => Promise<unknown> | unknown
}) {
  fireAndForget(input.label, () => runtimeTask({ ...input, task: () => input.task() }))
}

export async function InstanceBootstrap() {
  Log.Default.info("bootstrapping", { directory: Instance.directory })
  ShareNext.init()
  background({
    service: "Format.init",
    label: "format init",
    task: () => Format.init(),
  })
  await Promise.all([
    runtimeTask({
      service: "Plugin.init",
      label: "plugin init",
      task: () => Plugin.init(),
    }),
    runtimeTask({
      service: "LSP.init",
      label: "lsp init",
      task: () => LSP.init(),
    }),
  ])
  // Start provider loading in the background so it's ready by the time
  // the user sends their first prompt. Previously warmup was called
  // inside the prompt loop — after the user already typed — causing a
  // visible hang on the first message.
  background({
    service: "Provider.warmup",
    label: "provider warmup",
    task: () => Provider.warmup({ swallow: false }),
  })
  // Keep startup responsive: warm only a few representative semantic
  // servers in the background so the first real semantic/index request
  // does not pay the full cold-start penalty.
  background({
    service: "LSP.prewarmWorkspace",
    label: "lsp semantic prewarm",
    timeoutMs: BOOTSTRAP_PREWARM_TIMEOUT_MS,
    task: () =>
      LSP.prewarmWorkspace({
        mode: "semantic",
        methods: [...INDEXER_SEMANTIC_METHODS],
        maxFiles: BOOTSTRAP_PREWARM_MAX_FILES,
        maxLanguages: BOOTSTRAP_PREWARM_MAX_LANGUAGES,
      }),
  })
  background({
    service: "File.init",
    label: "file init",
    task: () => File.init(),
  })
  background({
    service: "FileWatcher.init",
    label: "file watcher init",
    task: () => FileWatcher.init(),
  })
  background({
    service: "Vcs.init",
    label: "vcs init",
    task: () => Vcs.init(),
  })
  background({
    service: "Snapshot.init",
    label: "snapshot init",
    task: () => Snapshot.init(),
  })

  Bus.subscribe(Command.Event.Executed, async (payload) => {
    if (payload.properties.name === Command.Default.INIT) {
      fireAndForget("project set initialized", () => Project.setInitialized(Instance.project.id))
    }
  })

  // Session lifecycle: auto-prune expired sessions on startup.
  // Runs in background — does not block bootstrap completion.
  const cfg = await Config.get()
  const autoPrune = cfg.session?.auto_prune ?? true
  const ttlDays = cfg.session?.ttl_days ?? 30
  if (autoPrune) {
    background({
      service: "Session.pruneExpired",
      label: "session auto-prune",
      task: () => Session.pruneExpired(ttlDays),
    })
  }
}
