import { cmd } from "../cmd"
import { UI } from "@/cli/ui"
import { win32DisableProcessedInput, win32InstallCtrlCGuard } from "./win32"
import { TuiConfig } from "@/config/tui"
import { Instance } from "@/project/instance"
import { existsSync } from "fs"
import { buildAttachAuthHeaders } from "../../attach-auth"
import { DEFAULT_SERVER_PORT } from "@/server/constants"
import { createTuiCrashHandler, registerTuiCrashHandlers } from "./util/lifecycle"

export const AttachCommand = cmd({
  command: "attach <url>",
  describe: "attach to a running ax-code server",
  builder: (yargs) =>
    yargs
      .positional("url", {
        type: "string",
        describe: `http://localhost:${DEFAULT_SERVER_PORT}`,
        demandOption: true,
      })
      .option("dir", {
        type: "string",
        description: "directory to run in",
      })
      .option("continue", {
        alias: ["c"],
        describe: "continue the last session",
        type: "boolean",
      })
      .option("session", {
        alias: ["s"],
        type: "string",
        describe: "session id to continue",
      })
      .option("fork", {
        type: "boolean",
        describe: "fork the session when continuing (use with --continue or --session)",
      })
      .option("password", {
        alias: ["p"],
        type: "string",
        describe: "basic auth password (defaults to AX_CODE_SERVER_PASSWORD)",
      }),
  handler: async (args) => {
    const unguard = win32InstallCtrlCGuard()
    const restoreInputMode = win32DisableProcessedInput()
    // Restore the terminal out of raw / mouse-tracking / alt-screen mode if an
    // uncaught exception escapes the attach session. Without this an unexpected
    // crash inside `tui()` leaves the shell prompt wedged (mirrors thread.ts).
    const unregisterCrashHandlers = registerTuiCrashHandlers(createTuiCrashHandler(), { namePrefix: "attach" })
    try {
      if (args.fork && !args.continue && !args.session) {
        UI.error("--fork requires --continue or --session")
        process.exitCode = 1
        return
      }

      const directory = (() => {
        if (!args.dir) return undefined
        try {
          process.chdir(args.dir)
          return process.cwd()
        } catch {
          // If the directory doesn't exist locally (remote attach), pass it through.
          return args.dir
        }
      })()
      const headers = buildAttachAuthHeaders(args.password)
      const config = await Instance.provide({
        directory: directory && existsSync(directory) ? directory : process.cwd(),
        fn: () => TuiConfig.get(),
      })
      const { tui } = await import("./app")
      await tui({
        url: args.url,
        config,
        args: {
          continue: args.continue,
          sessionID: args.session,
          fork: args.fork,
        },
        directory,
        headers,
      })
    } finally {
      unregisterCrashHandlers()
      restoreInputMode?.()
      unguard?.()
    }
  },
})
