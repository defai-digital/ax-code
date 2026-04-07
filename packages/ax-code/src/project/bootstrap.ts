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

export async function InstanceBootstrap() {
  Log.Default.info("bootstrapping", { directory: Instance.directory })
  await Plugin.init()
  ShareNext.init()
  Format.init()
  await LSP.init()
  File.init()
  FileWatcher.init()
  Vcs.init()
  Snapshot.init()

  Bus.subscribe(Command.Event.Executed, async (payload) => {
    if (payload.properties.name === Command.Default.INIT) {
      Project.setInitialized(Instance.project.id)
    }
  })

  // Session lifecycle: auto-prune expired sessions on startup.
  // Runs in background — does not block bootstrap completion.
  const cfg = await Config.get()
  const autoPrune = cfg.session?.auto_prune ?? true
  const ttlDays = cfg.session?.ttl_days ?? 30
  if (autoPrune) {
    Session.pruneExpired(ttlDays).catch((err) => Log.Default.warn("session auto-prune failed", { err }))
  }
}
