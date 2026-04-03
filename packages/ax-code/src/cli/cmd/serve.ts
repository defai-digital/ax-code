import { Server } from "../../server/server"
import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions, requireAuthForNetwork, isLocalhostOnly } from "../network"

export const ServeCommand = cmd({
  command: "serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a headless ax-code server",
  handler: async (args) => {
    const opts = await resolveNetworkOptions(args)
    requireAuthForNetwork(opts.hostname)
    if (!isLocalhostOnly(opts.hostname)) {
      console.log("Server is network-accessible — protected by AX_CODE_SERVER_PASSWORD")
    }
    const server = Server.listen(opts)
    console.log(`ax-code server listening on http://${server.hostname}:${server.port}`)

    await new Promise(() => {})
    await server.stop()
  },
})
