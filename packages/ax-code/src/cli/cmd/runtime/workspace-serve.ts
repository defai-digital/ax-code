import { cmd } from "../cmd"
import { withNetworkOptions, resolveNetworkOptions, requireAuthForNetwork } from "../../network"
import { WorkspaceServer } from "../../../control-plane/workspace-server/server"
import { registerShutdownSignals } from "../../../util/signals"

export const WorkspaceServeCommand = cmd({
  command: "workspace-serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a remote workspace event server",
  handler: async (args) => {
    const opts = await resolveNetworkOptions(args)
    requireAuthForNetwork(opts.hostname)
    const server = WorkspaceServer.Listen(opts)
    console.log(`workspace event server listening on http://${server.hostname}:${server.port}/event`)

    const shutdown = async () => {
      await server.stop()
      process.exit(0)
    }
    registerShutdownSignals(shutdown)

    await new Promise(() => {})
  },
})
