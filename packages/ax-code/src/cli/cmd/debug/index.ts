import { Global } from "../../../global"
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

type Signal = "SIGINT" | "SIGTERM"
type Hooks = {
  on: (signal: Signal, fn: () => void) => void
  off: (signal: Signal, fn: () => void) => void
}

export function waitForSignal(input: Hooks = process) {
  return new Promise<void>((resolve) => {
    const done = () => {
      input.off("SIGINT", done)
      input.off("SIGTERM", done)
      resolve()
    }
    input.on("SIGINT", done)
    input.on("SIGTERM", done)
  })
}

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
      .command({
        command: "wait",
        describe: "wait indefinitely (for debugging)",
        async handler() {
          await bootstrap(process.cwd(), async () => {
            await waitForSignal()
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
