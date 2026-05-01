import { Log } from "@/util/log"
import { bootstrap } from "../bootstrap"
import { cmd } from "./cmd"
import { AgentSideConnection, ndJsonStream } from "@agentclientprotocol/sdk"
import { ACP } from "@/acp/agent"
import { Server } from "@/server/server"
import { createOpencodeClient } from "@ax-code/sdk/v2"
import { withNetworkOptions, resolveNetworkOptions } from "../network"

const log = Log.create({ service: "acp-command" })

export const AcpCommand = cmd({
  command: "acp",
  describe: "start ACP (Agent Client Protocol) server",
  builder: (yargs) => {
    return withNetworkOptions(yargs).option("cwd", {
      describe: "working directory",
      type: "string",
      default: process.cwd(),
    })
  },
  handler: async (args) => {
    process.env.AX_CODE_CLIENT = "acp"
    await bootstrap(process.cwd(), async () => {
      const opts = await resolveNetworkOptions(args)
      const server = Server.listen(opts)
      let stopping = false

      const shutdown = async (signal: "SIGINT" | "SIGTERM") => {
        if (stopping) return
        stopping = true
        log.info("shutting down ACP server", { signal })
        await server.stop(true).catch((error) => {
          log.error("ACP shutdown failed", { signal, error })
        })
        process.exit(0)
      }

      const onSigint = () => {
        void shutdown("SIGINT")
      }
      const onSigterm = () => {
        void shutdown("SIGTERM")
      }
      process.on("SIGINT", onSigint)
      process.on("SIGTERM", onSigterm)

      const sdk = createOpencodeClient({
        baseUrl: `http://${server.hostname}:${server.port}`,
      })

      const input = new WritableStream<Uint8Array>({
        write(chunk) {
          return new Promise<void>((resolve, reject) => {
            process.stdout.write(chunk, (err) => {
              if (err) {
                reject(err)
              } else {
                resolve()
              }
            })
          })
        },
      })
      const output = new ReadableStream<Uint8Array>({
        start(controller) {
          process.stdin.on("data", (chunk: Buffer) => {
            controller.enqueue(new Uint8Array(chunk))
          })
          process.stdin.on("end", () => controller.close())
          process.stdin.on("error", (err) => controller.error(err))
        },
      })

      const stream = ndJsonStream(input, output)
      const agent = await ACP.init({ sdk })

      new AgentSideConnection((conn) => {
        return agent.create(conn, { sdk })
      }, stream)

      log.info("setup connection")
      process.stdin.resume()
      try {
        await new Promise((resolve, reject) => {
          process.stdin.on("end", resolve)
          process.stdin.on("error", reject)
        })
      } finally {
        process.off("SIGINT", onSigint)
        process.off("SIGTERM", onSigterm)
        await server.stop(true).catch((error) => {
          log.error("ACP stop failed", { error })
        })
      }
    })
  },
})
