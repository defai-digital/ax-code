import { cmd } from "../cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../../network"
import { WorkspaceServer } from "../../../control-plane/workspace-server/server"

export const WorkspaceServeCommand = cmd({
  command: "workspace-serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a remote workspace event server",
  handler: async (args) => {
    const opts = await resolveNetworkOptions(args)
    const server = WorkspaceServer.Listen(opts)
    console.log(`workspace event server listening on http://${server.hostname}:${server.port}/event`)

    const shutdown = async () => {
      await server.stop()
      process.exit(0)
    }
    process.on("SIGINT", shutdown)
    process.on("SIGTERM", shutdown)

    await new Promise(() => {})
  },
})
