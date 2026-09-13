import { Server } from "../../../server/server"
import { listenIpc, resolveIpcSocketPath } from "../../../server/ipc-transport"
import { cmd } from "../cmd"
import { withNetworkOptions, resolveNetworkOptions, requireAuthForNetwork } from "../../network"
import { registerShutdownSignals } from "../../../util/signals"
import { Instance } from "../../../project/instance"
import { InstanceBootstrap } from "../../../project/bootstrap"
import { Filesystem } from "../../../util/filesystem"
import { toErrorMessage } from "../../../util/error-message"
import { unlinkSync } from "node:fs"
import fs from "node:fs/promises"
import { ManagedRuntime } from "../../../runtime/managed-runtime"
import { ServerRuntimeAuth } from "../../../server/runtime-auth"

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
    const registryFile = process.env.AX_CODE_MANAGED_RUNTIME_FILE
    delete process.env.AX_CODE_MANAGED_RUNTIME_FILE
    const opts = await resolveNetworkOptions(args)
    requireAuthForNetwork(opts.hostname)
    const app = Server.createApp({ ...opts, runtimeAuth: !!registryFile })
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
      await Instance.disposeAll()
      await ipcServer?.stop(true)
      await server.stop(true)
      process.exit(0)
    }
    registerShutdownSignals(shutdown)

    if (registryFile) {
      const directory = await fs.realpath(process.env.AX_CODE_PROJECT || Filesystem.callerCwd())
      const info = ManagedRuntime.configure(directory, shutdown)
      const tempFile = `${registryFile}.${process.pid}.tmp`
      await fs.writeFile(
        tempFile,
        JSON.stringify({
          ...info,
          url: `http://127.0.0.1:${server.port}/`,
          token: ServerRuntimeAuth.headers()[ServerRuntimeAuth.HEADER],
        }),
        { mode: 0o600, flag: "wx" },
      )
      await fs.rename(tempFile, registryFile)
    }

    await new Promise(() => {})
  },
})
