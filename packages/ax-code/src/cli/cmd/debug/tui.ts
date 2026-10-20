import { cmd } from "../cmd"
import { startTuiInspector } from "@/tuimcp/inspector"

export const TuiDebugCommand = cmd({
  command: "tui",
  describe: "open a loopback developer inspector for an explicitly shared native TUI",
  builder: (yargs) =>
    yargs
      .option("endpoint", {
        type: "string",
        demandOption: true,
        describe: "Absolute endpoint.json path shown by ax-code --tui-debug",
      })
      .option("port", { type: "number", default: 0, describe: "Loopback port (0 chooses an available port)" }),
  async handler(args) {
    const inspector = await startTuiInspector(args.endpoint, args.port)
    console.log(`AX Code TUI Inspector: ${inspector.url}`)
    try {
      await new Promise<void>((resolve) => {
        const stop = () => {
          process.off("SIGINT", stop)
          process.off("SIGTERM", stop)
          resolve()
        }
        process.once("SIGINT", stop)
        process.once("SIGTERM", stop)
      })
    } finally {
      await inspector.close()
    }
  },
})
