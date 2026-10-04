import { cmd } from "./cmd"
import { serveTuiMcp } from "@/tuimcp/mcp-server"

export const McpTuiCommand = cmd({
  command: "tui",
  describe: "serve experimental MCP tools for an explicitly shared running TUI (POSIX only)",
  builder: (yargs) =>
    yargs.option("endpoint", {
      type: "string",
      demandOption: true,
      describe: "Absolute private endpoint.json path shown by a TUI started with --tui-mcp",
    }),
  async handler(args) {
    await serveTuiMcp(args.endpoint)
  },
})
