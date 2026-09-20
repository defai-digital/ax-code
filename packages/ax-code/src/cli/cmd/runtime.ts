import { cmd } from "./cmd"
import { RuntimeRegistry } from "@/runtime/runtime-registry"
import { DEFAULT_SERVER_PORT } from "@/server/constants"
import { restartRuntimeServer } from "./runtime/restart"
import { backendProcessCommand } from "../tui/thread"
import { Instance } from "@/project/instance"
import { TuiConfig } from "@/config/tui"
import { Filesystem } from "@/util/filesystem"
import { win32DisableProcessedInput, win32InstallCtrlCGuard } from "../tui/win32"
import { createTuiCrashHandler, registerTuiCrashHandlers } from "../tui/util/lifecycle"

export const RuntimeCommand = cmd({
  command: "runtime <action>",
  describe: "start, inspect, list, attach to, restart, or stop a persistent project runtime",
  builder: (yargs) =>
    yargs
      .positional("action", {
        choices: ["start", "status", "attach", "stop", "list", "restart"] as const,
        demandOption: true,
      })
      .option("dir", { type: "string", describe: "project directory" })
      .option("session", { type: "string", describe: "session to open when attaching" })
      .option("continue", { type: "boolean", describe: "open the last session when attaching" })
      .option("json", { type: "boolean", describe: "output machine-readable JSON" })
      .option("port", {
        type: "number",
        describe: "server port for restart when no managed runtime resolves",
        default: DEFAULT_SERVER_PORT,
      }),
  handler: async (args) => {
    const directory = args.dir || Filesystem.callerCwd()
    if (args.action === "list") {
      const entries = await RuntimeRegistry.list()
      if (args.json) {
        console.log(JSON.stringify(entries, null, 2))
        return
      }
      if (entries.length === 0) {
        console.log("No managed runtimes found.")
        return
      }
      console.log(
        ["state".padEnd(12), "pid".padEnd(8), "version".padEnd(14), "started".padEnd(25), "directory"].join(""),
      )
      for (const entry of entries) {
        console.log(
          [
            entry.state.padEnd(12),
            String(entry.record.pid).padEnd(8),
            entry.record.version.padEnd(14),
            new Date(entry.record.startedAt).toISOString().padEnd(25),
            entry.directory,
          ].join(""),
        )
      }
      return
    }
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
    if (args.action === "restart") {
      if (await restartRuntimeServer({ directory, port: args.port })) {
        console.log("ax-code server restarted")
      } else {
        console.error("Failed to restart — is the server running?")
        process.exit(1)
      }
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
