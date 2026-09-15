import { cmd } from "@/cli/cmd/cmd"

export const TuiBackendCommand = cmd({
  command: "tui-backend",
  describe: false,
  builder: (yargs) =>
    yargs.option("stdio", {
      type: "boolean",
      default: true,
      describe: "use stdio transport",
    }),
  handler: async () => {
    const { startTuiBackend } = await import("./worker")
    await startTuiBackend("stdio")
  },
})
