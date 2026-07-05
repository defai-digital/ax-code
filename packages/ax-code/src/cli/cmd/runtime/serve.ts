import { Server } from "../../../server/server"
import { listenIpc, resolveIpcSocketPath } from "../../../server/ipc-transport"
import { cmd } from "../cmd"
import { withNetworkOptions, resolveNetworkOptions, requireAuthForNetwork, isLocalhostOnly } from "../../network"
import { registerShutdownSignals } from "../../../util/signals"
import { Instance } from "../../../project/instance"
import { InstanceBootstrap } from "../../../project/bootstrap"
import { Filesystem } from "../../../util/filesystem"
import { toErrorMessage } from "../../../util/error-message"
import { unlinkSync } from "node:fs"

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
  builder: (yargs) =>
    withNetworkOptions(yargs).option("ipc-socket", {
      type: "string",
      describe: "path to a Unix domain socket for the local IPC transport",
    }),
  describe: "starts a headless ax-code server",
  handler: async (args) => {
    const opts = await resolveNetworkOptions(args)
    requireAuthForNetwork(opts.hostname)
    if (!isLocalhostOnly(opts.hostname)) {
      console.log("Server is network-accessible — protected by AX_CODE_SERVER_PASSWORD")
    }
    const app = Server.createApp(opts)
    const server = await Server.listen({ ...opts, app })

    let ipcServer: Awaited<ReturnType<typeof listenIpc>> | undefined
    if (args["ipc-socket"]) {
      const socketPath = resolveIpcSocketPath(args["ipc-socket"])
      try {
        unlinkSync(socketPath)
      } catch {
        // Ignore if the socket file does not already exist.
      }
      ipcServer = await listenIpc({
        socketPath,
        fetch: app.fetch,
        onListening: (listeningSocketPath) => console.log(`ax-code server ipc listening on ${listeningSocketPath}`),
      })
    }

    console.log(`ax-code server listening on http://${server.hostname}:${server.port}`)
    prewarmServeInstance()

    const shutdown = async () => {
      await ipcServer?.stop(true)
      await server.stop()
      process.exit(0)
    }
    registerShutdownSignals(shutdown)

    await new Promise(() => {})
  },
})
