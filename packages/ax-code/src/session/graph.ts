import z from "zod"
import { ExecutionGraph } from "../graph/index"
import { GraphFormat } from "../graph/format"
import type { SessionID } from "./schema"

export namespace SessionGraph {
  export const Snapshot = z
    .object({
      graph: z.lazy(() => ExecutionGraph.Graph),
      topology: GraphFormat.TopologyLine.array(),
    })
    .meta({
      ref: "SessionGraphSnapshot",
    })
  export type Snapshot = z.output<typeof Snapshot>

  export function snapshot(sessionID: SessionID): Snapshot {
    const graph = ExecutionGraph.build(sessionID)
    return {
      graph,
      topology: GraphFormat.topologyLines(graph),
    }
  }
}
