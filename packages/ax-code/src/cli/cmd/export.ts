import type { Argv } from "yargs"

export const ExportCommand = {
  command: "export [sessionID]",
  describe: "export session data as JSON",
  builder: (yargs: Argv) => {
    return yargs.positional("sessionID", {
      describe: "session id to export",
      type: "string",
    })
  },
  handler: async (args: any) => {
    const { ExportCommand: real } = await import("./storage/export")
    return real.handler(args)
  },
}
