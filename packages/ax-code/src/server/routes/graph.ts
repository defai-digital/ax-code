import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { SessionID } from "@/session/schema"
import z from "zod"
import { ExecutionGraph } from "../../graph"
import { GraphFormat } from "../../graph/format"
import { lazy } from "../../util/lazy"
import { errors } from "../error"
import { assertSessionExists } from "./session-lookup"

type GraphRouteContext = {
  req: {
    valid: (input: "param") => { sessionID: SessionID }
  }
}

async function parseSessionID(c: GraphRouteContext) {
  const sessionID = c.req.valid("param").sessionID
  await assertSessionExists(sessionID)
  return sessionID
}

export const GraphRoutes = lazy(() =>
  new Hono()
    .get(
      "/:sessionID/topology",
      describeRoute({
        summary: "Get execution graph topology",
        description: "Return the structured topology view for a session execution graph.",
        operationId: "graph.topology",
        responses: {
          200: {
            description: "Execution graph topology",
            content: {
              "application/json": {
                schema: resolver(GraphFormat.TopologyResponse),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ sessionID: SessionID.zod })),
      async (c) => {
        const sessionID = await parseSessionID(c)
        const graph = ExecutionGraph.build(sessionID)
        return c.json({ data: GraphFormat.topologyLines(graph) } satisfies GraphFormat.TopologyResponse)
      },
    )
    .get(
      "/:sessionID",
      describeRoute({
        summary: "Get execution graph",
        description: "Build and return the execution graph for a session.",
        operationId: "graph.get",
        responses: {
          200: {
            description: "Execution graph",
            content: {
              "application/json": {
                schema: resolver(ExecutionGraph.Response),
              },
              "text/plain": {
                schema: resolver(z.string()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ sessionID: SessionID.zod })),
      validator(
        "query",
        z.object({
          format: z
            .enum(["ascii", "json", "mermaid", "gantt", "svggantt", "markdown", "timeline", "topology"])
            .default("json"),
        }),
      ),
      async (c) => {
        const sessionID = await parseSessionID(c)
        const format = c.req.valid("query").format
        const graph = ExecutionGraph.build(sessionID)

        if (format === "ascii") return c.text(GraphFormat.ascii(graph).join("\n"))
        if (format === "mermaid") return c.text(GraphFormat.mermaid(graph))
        if (format === "gantt") return c.text(GraphFormat.gantt(graph))
        if (format === "svggantt") return c.text(GraphFormat.svgGantt(graph), 200, { "Content-Type": "image/svg+xml" })
        if (format === "markdown") return c.text(GraphFormat.markdown(graph))
        if (format === "timeline")
          return c.text(
            GraphFormat.timeline(graph)
              .map((line) => line.text)
              .join("\n"),
          )
        if (format === "topology") return c.text(GraphFormat.topology(graph).join("\n"))
        return c.json({ data: graph } satisfies ExecutionGraph.Response)
      },
    ),
)
