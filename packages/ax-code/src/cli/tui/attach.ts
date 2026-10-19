import { cmd } from "../cmd/cmd"
import { UI } from "@/cli/ui"
import { win32DisableProcessedInput, win32InstallCtrlCGuard } from "./win32"
import { existsSync } from "fs"
import { buildAttachAuthHeaders } from "../attach-auth"
import { DEFAULT_SERVER_PORT } from "@/constants/server"
import { withSessionContinuationOptions, withTuiMcpOption } from "../session-options"
import { createTuiCrashHandler, registerTuiCrashHandlers } from "./util/lifecycle"
import { assertLoopbackHttpUrl } from "@/util/listen-security"

export const AttachCommand = cmd({
  command: "attach <url>",
  describe: "attach to a running ax-code server",
  builder: (yargs) =>
    withSessionContinuationOptions(
      withTuiMcpOption(
        yargs
          .positional("url", {
            type: "string",
            describe: `http://localhost:${DEFAULT_SERVER_PORT}`,
            demandOption: true,
          })
          .option("dir", {
            type: "string",
            description: "directory to run in",
          }),
      ),
    )
      .option("password", {
        type: "string",
        describe: "basic auth password (defaults to AX_CODE_SERVER_PASSWORD)",
      })
      .option("screen", {
        type: "string",
        choices: ["auto", "full", "inline"] as const,
        // Hidden until the inline frontend ships (ADR-261 slice 2); the value is
        // already resolved and reported by doctor / debug explain.
        hidden: true,
        describe:
          "terminal screen mode (default auto). 'inline' opts into the inline split-footer renderer; overrides AX_CODE_TUI_SCREEN and tui.json `screen`",
      }),
  handler: async (args) => {
    const [{ assertTuiMcpPlatform }, { Instance }, { TuiConfig }] = await Promise.all([
      import("@/tuimcp/endpoint"),
      import("@/project/instance"),
      import("@/config/tui"),
    ])
    if (args.tuiMcp) assertTuiMcpPlatform()
    assertLoopbackHttpUrl(args.url, "attach URL")
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
        screen: args.screen,
        args: {
          tuiMcp: args.tuiMcp,
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
