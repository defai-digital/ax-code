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
        describe:
          "Narrow navigation to these exact HTTPS origins (HTTP is restricted to loopback development sites). Omit for unrestricted navigation (the product default, ADR-170)",
      })
      .option("name", { type: "string", default: "webmcp", describe: "MCP server name in the printed config" })
      .option("enable", {
        type: "boolean",
        default: false,
        describe: "Explicitly enable startup in the printed config",
      })
      .option("headless", { type: "boolean", default: false, describe: "Use an isolated headless Chrome" })
      .option("read", {
        type: "boolean",
        default: false,
        describe: "Enable the T1 read tier (page snapshot, screenshot, console) in the printed config",
      })
      .option("persistent-profile", {
        type: "boolean",
        default: false,
        describe: "Use a persistent AX-owned browser profile (requires the managed allowPersistentProfile requirement)",
      })
      .option("executable-path", { type: "string", describe: "Absolute path to an explicit Chrome 150+ executable" })
      .option("vendored", {
        type: "boolean",
        default: false,
        describe: "Launch a vendored, integrity-pinned bridge install (requires the managed allowVendored requirement)",
      }),
  async handler(args) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(args.name)) {
      throw new Error("MCP server name must contain 1-64 ASCII letters, digits, underscores or hyphens")
    }
    // A persistent profile always forces a visible window; refuse to generate
    // a config that claims headless instead of emitting a contradictory one.
    if (args.persistentProfile && args.headless) {
      throw new Error("Use either --headless or --persistent-profile, not both: a persistent profile is never headless")
    }
    const config = WebMcpProfile.config(
      {
        allowedOrigins: args.origin ?? [],
        headless: args.headless,
        read: args.read === true ? true : undefined,
        executablePath: args.executablePath,
        persistentProfile: args.persistentProfile,
        vendored: args.vendored,
      },
      args.enable,
    )
    process.stdout.write(JSON.stringify({ mcp: { [args.name]: config } }, null, 2) + "\n")
  },
})
