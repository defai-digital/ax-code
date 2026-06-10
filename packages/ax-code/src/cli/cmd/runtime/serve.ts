import { Server } from "../../../server/server"
import { cmd } from "../cmd"
import { withNetworkOptions, resolveNetworkOptions, requireAuthForNetwork, isLocalhostOnly } from "../../network"
import { registerShutdownSignals } from "../../../util/signals"
import { Instance } from "../../../project/instance"
import { InstanceBootstrap } from "../../../project/bootstrap"
import { Filesystem } from "../../../util/filesystem"
import { toErrorMessage } from "../../../util/error-message"

function prewarmServeInstance() {
  const directory = process.env.AX_CODE_PROJECT || Filesystem.callerCwd()
  void Instance.provide({
    directory,
    init: InstanceBootstrap,
    fn: () => undefined,
  }).catch((error) => {
    console.warn(`ax-code server project prewarm failed: ${toErrorMessage(error)}`)
  })
}

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
    prewarmServeInstance()

    const shutdown = async () => {
      await server.stop()
      process.exit(0)
    }
    registerShutdownSignals(shutdown)

    await new Promise(() => {})
  },
})
