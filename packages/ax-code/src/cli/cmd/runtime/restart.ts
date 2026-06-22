import { cmd } from "../cmd"
import { DEFAULT_SERVER_PORT } from "@/server/constants"

export function validateRuntimeRestartPort(port: unknown): number {
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("--port must be an integer between 1 and 65535")
  }
  return port
}

export const RestartCommand = cmd({
  command: "restart",
  describe: "restart the running ax-code server instance",
  builder: (yargs) =>
    yargs.option("port", {
      type: "number",
      describe: "server port",
      default: DEFAULT_SERVER_PORT,
    }).check((args) => {
      validateRuntimeRestartPort(args.port)
      return true
    }),
  handler: async (args) => {
    const port = validateRuntimeRestartPort(args.port)
    const url = `http://127.0.0.1:${port}/instance/restart`
    const res = await fetch(url, { method: "POST" }).catch(() => null)
    if (res?.ok) {
      console.log("ax-code server restarted")
    } else {
      console.error("Failed to restart — is the server running?")
      process.exit(1)
    }
  },
})
