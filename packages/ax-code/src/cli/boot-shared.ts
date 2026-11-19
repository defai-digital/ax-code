import { NamedError } from "@ax-code/util/error"
import yargs from "yargs"
import { fatal } from "./bootstrap/fatal"
import { init } from "./bootstrap/env"
import { migrate } from "./bootstrap/migrate"
import { cancelShellEnvLoad } from "../runtime/shell-env"
import { UI } from "./ui"
import { Installation } from "../installation"
import { Log } from "../util/log"
import { FORCED_EXIT_GRACE_MS, scheduleForcedExit } from "./boot-lifecycle"

// Shared yargs wiring for the two CLI entry points: boot.ts (full command
// table) and boot-node.ts (slim doctor/generate runtime). Each entry point
// installs its own failure handler on the returned instance.

export function createAxCodeCli(argv: string[], cmds: readonly unknown[]) {
  const rawArgv = argv.slice()
  let cli = yargs(argv)
    .parserConfiguration({ "populate--": true })
    .scriptName("ax-code")
    .wrap(100)
    .help("help", "show help")
    .alias("help", "h")
    .version("version", "show version number", Installation.VERSION)
    .alias("version", "v")
    .option("print-logs", {
      describe: "print logs to stderr",
      type: "boolean",
    })
    .option("log-level", {
      describe: "log level",
      type: "string",
      choices: ["DEBUG", "INFO", "WARN", "ERROR"],
    })
    .option("sandbox", {
      describe:
        "isolation sandbox mode (default: full-access / sandbox off); under --attach it is also sent per request and can only tighten the server's mode",
      type: "string",
      choices: ["read-only", "workspace-write", "full-access"],
    })
    .option("debug", {
      describe: "write local diagnostic logs to the OS temp directory",
      type: "boolean",
    })
    .option("debug-dir", {
      describe: "explicit directory for --debug diagnostic logs",
      type: "string",
    })
    .option("debug-include-content", {
      describe: "include prompt, output, and tool content in --debug logs",
      type: "boolean",
    })
    .middleware(async (opts) => {
      Object.defineProperty(opts, "__axCodeRawArgv", {
        value: rawArgv,
        enumerable: false,
      })
      await init(opts)
      // Skip database migration for commands that never touch the DB.
      // This avoids loading the SQLite module for --help, --version, etc.
      const skipMigration =
        rawArgv.some((a) => a === "--help" || a === "-h" || a === "--version" || a === "-v") ||
        rawArgv[0] === "completion"
      if (!skipMigration) await migrate()
    })
    .usage(
      "\n" +
        UI.logo() +
        '\n\n  Interactive TUI:  ax-code\n  Headless task:   ax-code run --model <provider/model> -- "prompt"',
    )
    .completion("completion", "generate shell completion script")

  for (const cmd of cmds) cli = cli.command(cmd as never)

  return { cli, rawArgv }
}

type CliOutputStream = {
  write(chunk: string, callback?: () => void): boolean
  writable?: boolean
  destroyed?: boolean
}

export async function flushCliOutput(
  streams: CliOutputStream[] = [process.stdout, process.stderr],
  timeoutMs = FORCED_EXIT_GRACE_MS,
) {
  await Promise.all(
    streams.map(
      (stream) =>
        new Promise<void>((resolve) => {
          if (stream.writable === false || stream.destroyed) {
            resolve()
            return
          }
          let settled = false
          const done = () => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            resolve()
          }
          const timer = setTimeout(done, timeoutMs)
          try {
            stream.write("", done)
          } catch {
            done()
          }
        }),
    ),
  )
}

export async function runAxCodeCli(cmd: { parse(): unknown }) {
  try {
    await cmd.parse()
  } catch (err) {
    // Provider, Config, and MCP stay off the --help graph: this module
    // formats those domain errors, and it is only needed once parse throws.
    const { FormatError } = await import("./error")
    fatal(err, {
      format: FormatError,
      ui: UI.error,
      file: Log.file,
      text: NamedError.message,
    })
    process.exitCode = 1
  } finally {
    // Drain queued JSON/help output before the forced-exit window starts.
    // Immediate process.exit() in a yargs failure handler truncates piped
    // output at the OS pipe buffer; natural exit remains the final fallback.
    await flushCliOutput()
    // Stop the background shell-env child so a finished one-shot command can
    // exit immediately instead of waiting for the login shell to finish.
    // Some subprocesses don't react properly to SIGTERM and similar signals
    // (most notably docker-container MCP servers without `docker run --init`),
    // so scheduleForcedExit leaves a brief window for async cleanup (DB WAL
    // flush, MCP disconnect) before forcing exit.
    await cancelShellEnvLoad()
    scheduleForcedExit()
  }
}
