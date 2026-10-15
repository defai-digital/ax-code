import { cmd } from "./cmd"
import type { SessionID } from "../../session/schema"
import { printNoSessionFound, resolveSession } from "./session-latest"

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
        choices: ["ascii", "json", "mermaid", "markdown", "timeline", "topology"] as const,
        default: "markdown" as const,
      })
      .option("json", {
        describe: "alias for --format json",
        type: "boolean",
        default: false,
      }),
  async handler(args) {
    const [{ Instance }, { EventQuery }, { ExecutionGraph }, { GraphFormat }] = await Promise.all([
      import("../../project/instance"),
      import("../../replay/query"),
      import("../../graph"),
      import("../../graph/format"),
    ])
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        let sessionID: SessionID
        const session = await resolveSession(args.sessionID as string | undefined)
        if (!session) {
          printNoSessionFound()
          return
        }
        sessionID = session.id

        const count = EventQuery.count(sessionID)
        if (count === 0) {
          console.log(`No events for session ${sessionID}.`)
          return
        }

        const graph = ExecutionGraph.build(sessionID)
        const format = args.json ? "json" : (args.format as string)

        switch (format) {
          case "ascii":
            console.log(GraphFormat.ascii(graph).join("\n"))
            return
          case "json":
            console.log(GraphFormat.json(graph))
            return
          case "mermaid":
            console.log(GraphFormat.mermaid(graph))
            return
          case "timeline":
            console.log(
              GraphFormat.timeline(graph)
                .map((line) => line.text)
                .join("\n"),
            )
            return
          case "topology":
            console.log(GraphFormat.topology(graph).join("\n"))
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
