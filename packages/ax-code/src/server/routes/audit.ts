import { Hono } from "hono"
import { describeRoute } from "hono-openapi"
import { validator } from "../validation"
import z from "zod"
import { AuditExport } from "../../audit/export"
import { parseAuditJsonLineResult } from "../../audit/json"
import { Replay } from "../../replay/replay"
import type { SessionID } from "../../session/schema"
import { Session } from "../../session"
import { lazy } from "../../util/lazy"
import { Log } from "../../util/log"
import { SESSION_ID_PARAM } from "./route-params"
import { parseCurrentProjectSessionID } from "./session-lookup"
import { Instance } from "../../project/instance"

const log = Log.create({ service: "audit.routes" })
const AUDIT_EXPORT_DEFAULT_LIMIT = 10_000
const AUDIT_EXPORT_MAX_LIMIT = 10_000

const AuditExportLimitQuery = z.object({
  limit: z.coerce.number().int().min(1).max(AUDIT_EXPORT_MAX_LIMIT).optional().default(AUDIT_EXPORT_DEFAULT_LIMIT),
})

const AuditExportAllQuery = AuditExportLimitQuery.extend({
  since: z.coerce.number().int().min(0).optional(),
  risk: z
    .enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"])
    .optional()
    .meta({ description: "Filter sessions by minimum risk level" }),
  type: z.string().optional().meta({ description: "Filter by event type (e.g. tool.call, agent.route)" }),
})

type AuditRecord = { session_id: string; event_type: string; [key: string]: unknown }

function isAuditRecord(value: unknown): value is AuditRecord {
  return value !== null && typeof value === "object" && "session_id" in value && "event_type" in value
}

// Parse a JSON-Lines entry and return null on failure instead of throwing.
// One corrupt line (partial write, truncation) previously blew up the
// whole /audit export — callers now skip null entries so the rest of the
// log is still returned.
export function parseAuditJsonLine(line: string): unknown | null {
  const parsed = parseAuditJsonLineResult(line)
  if (!parsed.ok) {
    log.warn("skipping corrupt audit line", { line: line.slice(0, 200), err: parsed.error })
    return null
  }
  return parsed.value
}

export async function collectAuditExportRecords(
  lines: Iterable<string>,
  options: {
    limit: number
    risk?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
    type?: string
  },
): Promise<AuditRecord[]> {
  const records: AuditRecord[] = []
  const riskOrder = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 } as const
  const minLevel = options.risk ? riskOrder[options.risk] : undefined
  const sessionRisks = new Map<string, number>()
  const RiskEngine = options.risk ? (await import("../../risk/score")).Risk : undefined

  for (const line of lines) {
    const record = parseAuditJsonLine(line)
    if (!isAuditRecord(record)) continue
    if (options.type && record.event_type !== options.type) continue
    if (RiskEngine && minLevel !== undefined) {
      let level = sessionRisks.get(record.session_id)
      if (level === undefined) {
        const assessment = RiskEngine.fromSession(record.session_id as SessionID)
        level = riskOrder[assessment.level]
        sessionRisks.set(record.session_id, level)
      }
      if (level < minLevel) continue
    }
    records.push(record)
    if (records.length >= options.limit) break
  }

  return records
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
      validator("param", SESSION_ID_PARAM),
      validator("query", AuditExportLimitQuery),
      async (c) => {
        const sessionID = await parseCurrentProjectSessionID(c)
        const { limit } = c.req.valid("query")
        const records = await collectAuditExportRecords(AuditExport.stream(sessionID), { limit })
        return c.json({ data: records })
      },
    )
    .get(
      "/export",
      describeRoute({
        summary: "Export all audit events",
        description: "Export all audit events for the current project, optionally filtered by date.",
        operationId: "audit.exportAll",
        responses: {
          200: { description: "JSON Lines audit export" },
        },
      }),
      validator("query", AuditExportAllQuery),
      async (c) => {
        const { since, risk, type, limit } = c.req.valid("query")
        // Scope the cross-session export to the current project directory so a
        // client connected to one project cannot enumerate another project's
        // audit events. AuditExport.streamAll does not itself filter by
        // directory, so we resolve the set of session IDs that belong to the
        // current project and only keep records for those sessions.
        const directory = Instance.directory
        const allowedSessions = new Set(Session.list({ directory }).map((s) => s.id))
        const records = (
          await collectAuditExportRecords(AuditExport.streamAll({ since }), { limit, risk, type })
        ).filter((record) => allowedSessions.has(record.session_id as SessionID))
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
      validator("param", SESSION_ID_PARAM),
      validator("query", z.object({ fromStep: z.coerce.number().optional() })),
      async (c) => {
        const sessionID = await parseCurrentProjectSessionID(c)
        const fromStep = c.req.valid("query").fromStep
        const { steps } = Replay.reconstructStream(sessionID, { fromStep })
        return c.json({ data: { steps } })
      },
    ),
)
