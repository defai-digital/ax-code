import { cmd } from "./cmd"
import { Instance } from "../../project/instance"
import { EventQuery } from "../../replay/query"
import { Session } from "../../session"
import { SessionID } from "../../session/schema"
import { ExecutionGraph } from "../../graph"
import { GraphFormat } from "../../graph/format"

export const GraphCommand = cmd({
  command: "graph [sessionID]",
  describe: "visualize session execution as a structured graph",
  builder: (yargs) =>
    yargs
      .positional("sessionID", {
        describe: "session ID (defaults to latest)",
        type: "string",
      })
      .option("format", {
        describe: "output format",
        choices: ["json", "mermaid", "markdown"] as const,
        default: "markdown" as const,
      })
      .option("json", {
        describe: "alias for --format json",
        type: "boolean",
        default: false,
      }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        let sessionID: SessionID
        if (args.sessionID) {
          sessionID = SessionID.make(args.sessionID as string)
        } else {
          let latest: Awaited<ReturnType<typeof Session.get>> | undefined
          for await (const s of Session.list({ limit: 1 })) {
            latest = s
          }
          if (!latest) {
            console.log("No sessions found. Run ax-code first.")
            return
          }
          sessionID = latest.id
        }

        const count = EventQuery.count(sessionID)
        if (count === 0) {
          console.log(`No events for session ${sessionID}.`)
          return
        }

        const graph = ExecutionGraph.build(sessionID)
        const format = args.json ? "json" : (args.format as string)

        switch (format) {
          case "json":
            console.log(GraphFormat.json(graph))
            return
          case "mermaid":
            console.log(GraphFormat.mermaid(graph))
            return
          case "markdown":
          default:
            console.log(GraphFormat.markdown(graph))
            return
        }
      },
    })
  },
})
