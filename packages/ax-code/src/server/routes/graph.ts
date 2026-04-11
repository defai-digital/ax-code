import { Hono } from "hono"
import { describeRoute, validator } from "hono-openapi"
import { SessionID } from "@/session/schema"
import z from "zod"
import { ExecutionGraph } from "../../graph"
import { GraphFormat } from "../../graph/format"
import { lazy } from "../../util/lazy"

export const GraphRoutes = lazy(() =>
  new Hono()
    .get(
      "/:sessionID",
      describeRoute({
        summary: "Get execution graph",
        description: "Build and return the execution graph for a session.",
        operationId: "graph.get",
        responses: {
          200: { description: "Execution graph" },
        },
      }),
      validator("param", z.object({ sessionID: z.string() })),
      validator("query", z.object({
        format: z.enum(["json", "mermaid", "markdown"]).default("json"),
      })),
      async (c) => {
        const sid = SessionID.make(c.req.valid("param").sessionID)
        const format = c.req.valid("query").format
        const graph = ExecutionGraph.build(sid)

        if (format === "mermaid") return c.text(GraphFormat.mermaid(graph))
        if (format === "markdown") return c.text(GraphFormat.markdown(graph))
        return c.json({ data: graph })
      },
    ),
)
