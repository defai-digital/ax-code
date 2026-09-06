import { cmd } from "./cmd"
import { WebMcpProfile } from "@/mcp/webmcp-profile"

export const McpWebMcpCommand = cmd({
  command: "webmcp",
  describe: "print experimental WebMCP bridge config (no install, connection, or file changes)",
  builder: (yargs) =>
    yargs
      .option("origin", {
        type: "string",
        array: true,
        demandOption: true,
        describe: "Exact allowed HTTPS origins (HTTP is restricted to loopback development sites)",
      })
      .option("name", { type: "string", default: "webmcp", describe: "MCP server name in the printed config" })
      .option("enable", {
        type: "boolean",
        default: false,
        describe: "Explicitly enable startup in the printed config",
      })
      .option("headless", { type: "boolean", default: false, describe: "Use an isolated headless Chrome" })
      .option("executable-path", { type: "string", describe: "Absolute path to an explicit Chrome 150+ executable" }),
  async handler(args) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(args.name)) {
      throw new Error("MCP server name must contain 1-64 ASCII letters, digits, underscores or hyphens")
    }
    const config = WebMcpProfile.config(
      { allowedOrigins: args.origin, headless: args.headless, executablePath: args.executablePath },
      args.enable,
    )
    process.stdout.write(JSON.stringify({ mcp: { [args.name]: config } }, null, 2) + "\n")
  },
})
