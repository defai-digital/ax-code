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

function background(label: string, task: () => Promise<unknown> | unknown) {
  const handle = (err: unknown) => {
    if (isHarmlessEffectInterrupt(err)) return
    Log.Default.warn(`${label} failed`, { err })
  }
  try {
    Promise.resolve(task()).catch(handle)
  } catch (err) {
    handle(err)
  }
}

export async function InstanceBootstrap() {
  Log.Default.info("bootstrapping", { directory: Instance.directory })
  ShareNext.init()
  background("format init", () => Format.init())
  await Promise.all([Plugin.init(), LSP.init()])
  // Start provider loading in the background so it's ready by the time
  // the user sends their first prompt. Previously warmup was called
  // inside the prompt loop — after the user already typed — causing a
  // visible hang on the first message.
  Provider.warmup()
  background("file init", () => File.init())
  background("file watcher init", () => FileWatcher.init())
  background("vcs init", () => Vcs.init())
  background("snapshot init", () => Snapshot.init())

  Bus.subscribe(Command.Event.Executed, async (payload) => {
    if (payload.properties.name === Command.Default.INIT) {
      background("project set initialized", () => Project.setInitialized(Instance.project.id))
    }
  })

  // Session lifecycle: auto-prune expired sessions on startup.
  // Runs in background — does not block bootstrap completion.
  const cfg = await Config.get()
  const autoPrune = cfg.session?.auto_prune ?? true
  const ttlDays = cfg.session?.ttl_days ?? 30
  if (autoPrune) {
    background("session auto-prune", () => Session.pruneExpired(ttlDays))
  }
}
