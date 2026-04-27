import { Hono } from "hono"
import { describeRoute, validator } from "hono-openapi"
import { SessionID } from "@/session/schema"
import z from "zod"
import { AuditExport } from "../../audit/export"
import { EventQuery } from "../../replay/query"
import { Replay } from "../../replay/replay"
import { lazy } from "../../util/lazy"
import { Log } from "../../util/log"

const log = Log.create({ service: "audit.routes" })

// Parse a JSON-Lines entry and return null on failure instead of throwing.
// One corrupt line (partial write, truncation) previously blew up the
// whole /audit export — callers now skip null entries so the rest of the
// log is still returned.
function parseLine(line: string): unknown | null {
  try {
    return JSON.parse(line)
  } catch (err) {
    log.warn("skipping corrupt audit line", { line: line.slice(0, 200), err })
    return null
  }
}

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
        return c.json({ data: lines.map(parseLine).filter((x) => x !== null) })
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
      validator(
        "query",
        z.object({
          since: z.coerce.number().int().min(0).optional(),
          risk: z
            .enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"])
            .optional()
            .meta({ description: "Filter sessions by minimum risk level" }),
          type: z.string().optional().meta({ description: "Filter by event type (e.g. tool.call, agent.route)" }),
        }),
      ),
      async (c) => {
        const { since, risk, type } = c.req.valid("query")
        type AuditRecord = { session_id: string; event_type: string; [key: string]: unknown }
        let records = [...AuditExport.streamAll({ since })]
          .map(parseLine)
          .filter((x): x is AuditRecord => x !== null && typeof x === "object" && "session_id" in (x as object))
        if (type) records = records.filter((r) => r.event_type === type)
        if (risk) {
          const { Risk: RiskEngine } = await import("../../risk/score")
          const riskOrder = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 } as const
          const minLevel = riskOrder[risk]
          const sessionRisks = new Map<string, number>()
          for (const r of records) {
            if (!sessionRisks.has(r.session_id)) {
              const assessment = RiskEngine.fromSession(r.session_id as any)
              sessionRisks.set(r.session_id, riskOrder[assessment.level])
            }
          }
          records = records.filter((r) => (sessionRisks.get(r.session_id) ?? 0) >= minLevel)
        }
        return c.json({ data: records })
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
