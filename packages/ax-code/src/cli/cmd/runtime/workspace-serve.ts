import { cmd } from "../cmd"
import { withNetworkOptions, resolveNetworkOptions, requireAuthForNetwork } from "../../network"
import { WorkspaceServer } from "../../../control-plane/workspace-server/server"

export const WorkspaceServeCommand = cmd({
  command: "workspace-serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a remote workspace event server",
  handler: async (args) => {
    const opts = await resolveNetworkOptions(args)
    requireAuthForNetwork(opts.hostname)
    const server = WorkspaceServer.Listen(opts)
    console.log(`workspace event server listening on http://${server.hostname}:${server.port}/event`)

    let stopping = false
    const shutdown = async () => {
      if (stopping) return
      stopping = true
      await server.stop()
      process.exit(0)
    }
    process.on("SIGINT", shutdown)
    process.on("SIGTERM", shutdown)

    await new Promise(() => {})
  },
})
