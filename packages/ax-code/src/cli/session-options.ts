import type { Argv } from "yargs"

/** Session continuation options shared by the TUI, attach, and run commands. */
export function withSessionContinuationOptions<T>(yargs: Argv<T>) {
  return yargs
    .option("continue", {
      alias: ["c"],
      describe: "continue the last session",
      type: "boolean",
    })
    .option("session", {
      alias: ["s"],
      describe: "session id to continue",
      type: "string",
    })
    .option("fork", {
      type: "boolean",
      describe: "fork the session before continuing (requires --continue or --session)",
    })
}

/** Shared by the TUI and attach commands (POSIX-only experimental surface). */
export function withTuiMcpOption<T>(yargs: Argv<T>) {
  return yargs.option("tui-mcp", {
    type: "boolean",
    default: false,
    describe: "Share this live TUI through experimental local MCP navigation tools (POSIX only)",
  })
}
