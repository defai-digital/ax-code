import { cmd } from "./cmd"

export const RestartCommand = cmd({
  command: "restart",
  describe: "restart the running ax-code server instance",
  builder: (yargs) =>
    yargs.option("port", {
      type: "number",
      describe: "server port",
      default: 4096,
    }),
  handler: async (args) => {
    const url = `http://127.0.0.1:${args.port}/instance/restart`
    const res = await fetch(url, { method: "POST" }).catch(() => null)
    if (res?.ok) {
      console.log("ax-code server restarted")
    } else {
      console.error("Failed to restart — is the server running?")
      process.exit(1)
    }
  },
})
