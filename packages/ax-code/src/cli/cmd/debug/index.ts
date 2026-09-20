import { Global } from "../../../global"
import { Log } from "../../../util/log"
import { bootstrap } from "../../bootstrap"
import { cmd } from "../cmd"
import { ConfigCommand } from "./config"
import { ExplainCommand } from "./explain"
import { FileCommand } from "./file"
import { LSPCommand } from "./lsp"
import { PerfCommand } from "./perf"
import { RipgrepCommand } from "./ripgrep"
import { ScrapCommand } from "./scrap"
import { SkillCommand } from "./skill"
import { SnapshotCommand } from "./snapshot"
import { AgentCommand } from "./agent"

export const DebugCommand = cmd({
  command: "debug",
  describe: "debugging and troubleshooting tools",
  builder: (yargs) =>
    yargs
      .command(ConfigCommand)
      .command(ExplainCommand)
      .command(LSPCommand)
      .command(PerfCommand)
      .command(RipgrepCommand)
      .command(FileCommand)
      .command(ScrapCommand)
      .command(SkillCommand)
      .command(SnapshotCommand)
      .command(AgentCommand)
      .command(PathsCommand)
      .command(PruneLogsCommand)
      .command({
        command: "wait",
        describe: "wait indefinitely (for debugging)",
        async handler() {
          await bootstrap(process.cwd(), async () => {
            await new Promise<void>((resolve) => {
              const timer = setTimeout(resolve, 1_000 * 60 * 60 * 24)
              timer.unref?.()
            })
          })
        },
      })
      .demandCommand(),
  async handler() {},
})

const PathsCommand = cmd({
  command: "paths",
  describe: "show global paths (data, config, cache, state)",
  handler() {
    for (const [key, value] of Object.entries(Global.Path)) {
      console.log(key.padEnd(10), value)
    }
  },
})

const PruneLogsCommand = cmd({
  command: "prune-logs",
  describe: "delete old and empty diagnostic log files",
  handler: async () => {
    const result = await Log.prune(Global.Path.log)
    console.log(`Removed ${result.removed} log file(s); kept ${result.kept} in ${Global.Path.log}`)
  },
})
