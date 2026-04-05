import type { Argv } from "yargs"
import { SessionID } from "../../session/schema"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { AuditExport } from "../../audit/export"
import { EventQuery } from "../../replay/query"
import { EOL } from "os"

const AuditPruneCommand = cmd({
  command: "prune",
  describe: "delete audit events older than N days",
  builder: (yargs: Argv) =>
    yargs.option("days", {
      describe: "delete audit events older than this many days",
      type: "number",
      default: 90,
    }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const cutoffMs = args.days * 24 * 60 * 60 * 1000
      const removed = EventQuery.pruneOlderThan(cutoffMs)
      if (removed === 0) {
        process.stderr.write(`No audit events older than ${args.days} days${EOL}`)
        return
      }
      process.stderr.write(`Pruned ${removed} audit event${removed === 1 ? "" : "s"} older than ${args.days} days${EOL}`)
    })
  },
})

const AuditExportCommand = cmd({
  command: "export [sessionID]",
  describe: "export audit events as JSON Lines",
  builder: (yargs: Argv) => {
    return yargs
      .positional("sessionID", {
        describe: "session ID to export",
        type: "string",
      })
      .option("all", {
        type: "boolean",
        describe: "export all sessions",
        default: false,
      })
      .option("since", {
        type: "string",
        describe: "ISO date cutoff (e.g. 2026-04-01)",
      })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const ctx = await AuditExport.policyContext(process.cwd())
      if (args.sessionID) {
        const sid = SessionID.make(args.sessionID)
        const count = EventQuery.count(sid)
        process.stderr.write(`Exporting ${count} events for session ${args.sessionID}${EOL}`)
        for (const line of AuditExport.stream(sid, ctx)) {
          process.stdout.write(line + EOL)
        }
      } else if (args.all) {
        const since = args.since ? new Date(args.since).getTime() : undefined
        process.stderr.write(`Exporting all events${since ? ` since ${args.since}` : ""}${EOL}`)
        for (const line of AuditExport.streamAll({ since }, ctx)) {
          process.stdout.write(line + EOL)
        }
      } else {
        process.stderr.write(`Usage: ax-code audit export <sessionID> or ax-code audit export --all${EOL}`)
        process.exit(1)
      }
    })
  },
})

const AuditOtlpCommand = cmd({
  command: "otlp <sessionID>",
  describe: "export session as OpenTelemetry trace spans",
  builder: (yargs: Argv) =>
    yargs.positional("sessionID", {
      describe: "session ID to export",
      type: "string",
      demandOption: true,
    }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const { Telemetry } = await import("../../telemetry")
      if (!Telemetry.enabled()) {
        process.stderr.write(`Set AX_CODE_OTLP_ENDPOINT to enable OTLP export${EOL}`)
        process.exit(1)
      }
      const sid = SessionID.make(args.sessionID)
      const count = EventQuery.count(sid)
      if (count === 0) {
        process.stderr.write(`No events found for session ${args.sessionID}${EOL}`)
        process.exit(1)
      }
      process.stderr.write(`Exporting ${count} events as OTLP trace for session ${args.sessionID}${EOL}`)
      await Telemetry.exportSession(sid)
      await Telemetry.shutdown()
      process.stderr.write(`Done${EOL}`)
    })
  },
})

export const AuditCommand = cmd({
  command: "audit",
  describe: "audit trail tools",
  builder: (yargs: Argv) =>
    yargs
      .command(AuditExportCommand as never)
      .command(AuditPruneCommand as never)
      .command(AuditOtlpCommand as never)
      .demandCommand(),
  handler: async () => {},
})
