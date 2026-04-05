import { Hono } from "hono"
import { describeRoute, validator } from "hono-openapi"
import { SessionID } from "@/session/schema"
import z from "zod"
import { AuditExport } from "../../audit/export"
import { EventQuery } from "../../replay/query"
import { Replay } from "../../replay/replay"
import { lazy } from "../../util/lazy"

export const AuditRoutes = lazy(() =>
  new Hono()
    .get(
      "/export/:sessionID",
      describeRoute({
        summary: "Export audit events",
        description: "Export all audit events for a session as JSON Lines.",
        operationId: "audit.export",
        responses: {
          200: { description: "JSON Lines audit export" },
        },
      }),
      validator("param", z.object({ sessionID: z.string() })),
      async (c) => {
        const sid = SessionID.make(c.req.valid("param").sessionID)
        const lines = [...AuditExport.stream(sid)]
        return c.json({ data: lines.map((l) => JSON.parse(l)) })
      },
    )
    .get(
      "/export",
      describeRoute({
        summary: "Export all audit events",
        description: "Export all audit events, optionally filtered by date.",
        operationId: "audit.exportAll",
        responses: {
          200: { description: "JSON Lines audit export" },
        },
      }),
      validator("query", z.object({ since: z.string().optional() })),
      async (c) => {
        const since = c.req.valid("query").since ? new Date(c.req.valid("query").since!).getTime() : undefined
        const lines = [...AuditExport.streamAll({ since })]
        return c.json({ data: lines.map((l) => JSON.parse(l)) })
      },
    )
    .get(
      "/replay/:sessionID",
      describeRoute({
        summary: "Reconstruct replay",
        description: "Reconstruct session replay steps from recorded events.",
        operationId: "audit.replay",
        responses: {
          200: { description: "Reconstructed replay steps" },
        },
      }),
      validator("param", z.object({ sessionID: z.string() })),
      validator("query", z.object({ fromStep: z.coerce.number().optional() })),
      async (c) => {
        const sid = SessionID.make(c.req.valid("param").sessionID)
        const fromStep = c.req.valid("query").fromStep
        const { steps } = Replay.reconstructStream(sid, { fromStep })
        return c.json({ data: { steps } })
      },
    ),
)
