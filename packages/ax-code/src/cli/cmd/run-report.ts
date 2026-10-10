import open from "open"
import { RunReportServer } from "./run-report-server"
import { Instance } from "../../project/instance"
import { cmd } from "./cmd"
import { printNoSessionFound, resolveSession } from "./session-latest"

async function target(id?: string) {
  return Instance.provide({
    directory: process.cwd(),
    fn: async () => {
      const session = await resolveSession(id)
      if (!session) return

      return { sid: session.id, dir: session.directory }
    },
  })
}

export const RunReportCommand = cmd({
  command: "run-report [sessionID]",
  describe: "open the run report in a browser",
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
        describe: "open the run report session index",
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
      printNoSessionFound()
      return
    }

    const server = await RunReportServer.listen(args.port as number)
    const url = new URL(
      args.index ? "/run-report" : `/run-report/session/${hit!.sid}`,
      `http://${server.hostname}:${server.port}`,
    )
    url.searchParams.set("directory", args.index ? process.cwd() : hit!.dir)

    console.log(`Run report listening on ${url}`)
    if (args.open) await open(url.toString()).catch(() => undefined)

    let stopping = false
    const shutdown = async () => {
      if (stopping) return
      stopping = true
      await server.stop(true)
      process.exit(0)
    }
    process.on("SIGINT", shutdown)
    process.on("SIGTERM", shutdown)

    await new Promise(() => {})
  },
})
