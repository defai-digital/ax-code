import { cmd } from "./cmd"
import { RuntimeRegistry } from "@/runtime/runtime-registry"
import { backendProcessCommand } from "../tui/thread"
import { Instance } from "@/project/instance"
import { TuiConfig } from "@/config/tui"
import { Filesystem } from "@/util/filesystem"
import { win32DisableProcessedInput, win32InstallCtrlCGuard } from "../tui/win32"
import { createTuiCrashHandler, registerTuiCrashHandlers } from "../tui/util/lifecycle"

export const RuntimeCommand = cmd({
  command: "runtime <action>",
  describe: "start, inspect, attach to, or stop a persistent project runtime",
  builder: (yargs) =>
    yargs
      .positional("action", { choices: ["start", "status", "attach", "stop"] as const, demandOption: true })
      .option("dir", { type: "string", describe: "project directory" })
      .option("session", { type: "string", describe: "session to open when attaching" })
      .option("continue", { type: "boolean", describe: "open the last session when attaching" }),
  handler: async (args) => {
    const directory = args.dir || Filesystem.callerCwd()
    if (args.action === "status") {
      const status = await RuntimeRegistry.status(directory)
      const info = "record" in status ? status.record : undefined
      console.log(
        JSON.stringify(
          {
            state: status.state,
            directory: status.directory,
            ...(info ? { pid: info.pid, host: info.host, version: info.version, startedAt: info.startedAt } : {}),
          },
          null,
          2,
        ),
      )
      return
    }
    if (args.action === "stop") {
      console.log((await RuntimeRegistry.stop(directory)) ? "Runtime stopped." : "No managed runtime for this project.")
      return
    }
    const record = await RuntimeRegistry.start(
      directory,
      backendProcessCommand(["serve", "--hostname", "127.0.0.1", "--port", "0"]),
    )
    if (args.action === "start") {
      console.log(`Runtime running on ${record.host} (PID ${record.pid}).`)
      console.log("Use ax-code runtime attach to connect; ax-code runtime stop to stop its work.")
      return
    }
    const unguard = win32InstallCtrlCGuard()
    const restoreInputMode = win32DisableProcessedInput()
    const unregisterCrashHandlers = registerTuiCrashHandlers(createTuiCrashHandler(), { namePrefix: "runtime-attach" })
    try {
      process.chdir(record.directory)
      const config = await Instance.provide({ directory: record.directory, fn: () => TuiConfig.get() })
      const { tui } = await import("../tui/app")
      await tui({
        url: record.url.replace(/\/$/, ""),
        headers: RuntimeRegistry.headers(record),
        directory: record.directory,
        config,
        args: {
          sessionID: args.session,
          continue: args.continue,
          persistentRuntime: { host: record.host, pid: record.pid },
        },
      })
    } finally {
      unregisterCrashHandlers()
      restoreInputMode?.()
      unguard?.()
    }
  },
})
