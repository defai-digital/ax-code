import open from "open"
import { Instance } from "../../project/instance"
import { Server } from "../../server/server"
import { Session } from "../../session"
import { SessionID } from "../../session/schema"
import { cmd } from "./cmd"

async function target(id?: string) {
  return Instance.provide({
    directory: process.cwd(),
    fn: async () => {
      if (id) {
        const sid = SessionID.make(id)
        const session = await Session.get(sid)
        return { sid, dir: session.directory }
      }

      let latest: Awaited<ReturnType<typeof Session.get>> | undefined
      for await (const item of Session.list({ limit: 1 })) latest = item
      if (!latest) return

      return { sid: latest.id, dir: latest.directory }
    },
  })
}

export const DreGraphCommand = cmd({
  command: "dre-graph [sessionID]",
  describe: "open a browser DRE graph view",
  builder: (yargs) =>
    yargs
      .positional("sessionID", {
        describe: "session ID (defaults to latest)",
        type: "string",
      })
      .option("port", {
        describe: "port to listen on",
        type: "number",
        default: 0,
      })
      .option("index", {
        describe: "open the DRE graph session index",
        type: "boolean",
        default: false,
      })
      .option("open", {
        describe: "open the browser automatically",
        type: "boolean",
        default: true,
      }),
  async handler(args) {
    const hit = args.index ? undefined : await target(args.sessionID as string | undefined)
    if (!args.index && !hit) {
      console.log("No sessions found. Run ax-code first.")
      return
    }

    const server = Server.listen({
      hostname: "127.0.0.1",
      port: args.port as number,
      mdns: false,
      cors: [],
    })
    const url = new URL(
      args.index ? "/dre-graph" : `/dre-graph/session/${hit!.sid}`,
      `http://${server.hostname}:${server.port}`,
    )
    url.searchParams.set("directory", args.index ? process.cwd() : hit!.dir)

    console.log(`DRE Graph listening on ${url}`)
    if (args.open) await open(url.toString()).catch(() => undefined)

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
