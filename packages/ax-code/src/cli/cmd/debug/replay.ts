import { EOL } from "os"
import { pathToFileURL } from "url"
import { bootstrap } from "../../bootstrap"
import { cmd } from "../cmd"
import { LSP } from "../../../lsp"
import { AuditQuery } from "../../../audit/query"
import { AuditCallID } from "../../../audit/id"

// Replay a previously-recorded semantic call.
//
// Reads the audit_semantic_call row by id, re-executes the operation
// against the current LSP state, and prints both envelopes side-by-
// side with a diff on the fields that are expected to match.
//
// Scope of the "match" claim: decision-path equivalence, not semantic-
// output equivalence. External LSP servers are not deterministic, so
// the payload itself may legitimately differ between recording and
// replay (reindex, edits, server restart). The asserted fields are:
//   - source       (lsp vs cache — cache-path replay should still hit)
//   - completeness (full / partial / empty)
//   - cacheKey     (same row served when applicable)
//
// timestamp and serverIDs are expected to differ and are shown but
// not diffed.

type RecordedArgs = {
  operation: string
  query?: string
  filePath?: string
  line?: number
  character?: number
}

type RecordedEnvelope = {
  source: string
  completeness: string
  timestamp: number
  serverIDs: string[]
  cacheKey?: string
  data?: unknown
  symbols?: unknown
}

async function rerun(args: RecordedArgs): Promise<RecordedEnvelope> {
  // Must mirror src/tool/lsp.ts's operation dispatch. We call the
  // envelope-returning variants directly so we can diff envelopes,
  // not bare arrays.
  switch (args.operation) {
    case "workspaceSymbol":
      return (await LSP.workspaceSymbolEnvelope(args.query ?? "")) as unknown as RecordedEnvelope
    case "goToDefinition":
      return (await LSP.definitionEnvelope({
        file: args.filePath!,
        line: (args.line ?? 1) - 1,
        character: (args.character ?? 1) - 1,
      })) as unknown as RecordedEnvelope
    case "findReferences":
      return ((await LSP.referencesCachedEnvelope({
        file: args.filePath!,
        line: (args.line ?? 1) - 1,
        character: (args.character ?? 1) - 1,
      })) ??
        (await LSP.referencesEnvelope({
          file: args.filePath!,
          line: (args.line ?? 1) - 1,
          character: (args.character ?? 1) - 1,
          cache: true,
        }))) as unknown as RecordedEnvelope
    case "hover":
      return (await LSP.hoverEnvelope({
        file: args.filePath!,
        line: (args.line ?? 1) - 1,
        character: (args.character ?? 1) - 1,
      })) as unknown as RecordedEnvelope
    case "documentSymbol": {
      const uri = pathToFileURL(args.filePath!).href
      return ((await LSP.documentSymbolCachedEnvelope(uri)) ??
        (await LSP.documentSymbolEnvelope(uri, { cache: true }))) as unknown as RecordedEnvelope
    }
    case "goToImplementation":
      return (await LSP.implementationEnvelope({
        file: args.filePath!,
        line: (args.line ?? 1) - 1,
        character: (args.character ?? 1) - 1,
      })) as unknown as RecordedEnvelope
    case "prepareCallHierarchy":
      return (await LSP.prepareCallHierarchyEnvelope({
        file: args.filePath!,
        line: (args.line ?? 1) - 1,
        character: (args.character ?? 1) - 1,
      })) as unknown as RecordedEnvelope
    case "incomingCalls":
      return (await LSP.incomingCallsEnvelope({
        file: args.filePath!,
        line: (args.line ?? 1) - 1,
        character: (args.character ?? 1) - 1,
      })) as unknown as RecordedEnvelope
    case "outgoingCalls":
      return (await LSP.outgoingCallsEnvelope({
        file: args.filePath!,
        line: (args.line ?? 1) - 1,
        character: (args.character ?? 1) - 1,
      })) as unknown as RecordedEnvelope
    default:
      throw new Error(
        `replay not yet supported for operation "${args.operation}". Envelope-returning variants only cover the operations exposed by the semantic LSP surface.`,
      )
  }
}

export const ReplayCommand = cmd({
  command: "replay <id>",
  describe: "replay a recorded semantic call by audit id",
  builder: (yargs) =>
    yargs.positional("id", { type: "string", demandOption: true, describe: "audit call id (asc_...)" }).option("json", {
      describe: "output machine-readable JSON",
      type: "boolean",
      default: false,
    }),
  async handler(argv) {
    await bootstrap(process.cwd(), async () => {
      const id = AuditCallID.make(argv.id)
      const row = AuditQuery.getById(id)
      if (!row) {
        process.stdout.write(`no audit row for id ${argv.id}${EOL}`)
        process.exitCode = 1
        return
      }

      const recordedArgs = row.args_json as RecordedArgs
      const recordedEnvelope = row.envelope_json as RecordedEnvelope

      // If the original call failed before reaching the LSP layer
      // (MissingQuery, MissingFilePath, FileNotFound, etc.), its args
      // may be missing required fields or pointing at nonexistent
      // files. Re-running would either throw or silently pick
      // different values (undefined line -> 0), producing a false-
      // positive mismatch. Report the recorded error and stop.
      if (row.error_code) {
        if (argv.json) {
          process.stdout.write(
            JSON.stringify(
              {
                id: row.id,
                tool: row.tool,
                operation: row.operation,
                args: recordedArgs,
                recorded: recordedEnvelope,
                replayed: null,
                mismatches: [],
                skipped: true,
                skipReason: `original call failed with error_code=${row.error_code}; replay skipped`,
              },
              null,
              2,
            ) + EOL,
          )
          return
        }
        console.log("")
        console.log(`  audit id:    ${row.id}`)
        console.log(`  tool:        ${row.tool}`)
        console.log(`  operation:   ${row.operation}`)
        console.log(`  recorded at: ${new Date(row.time_created).toISOString()}`)
        console.log(`  error_code:  ${row.error_code}`)
        console.log("")
        console.log("  replay skipped: original call failed before reaching LSP; args may be incomplete.")
        return
      }

      const replayed = await rerun(recordedArgs)

      const compareFields = ["source", "completeness"] as const
      const mismatches: { field: string; recorded: unknown; replayed: unknown }[] = []
      for (const field of compareFields) {
        if (recordedEnvelope[field] !== replayed[field]) {
          mismatches.push({ field, recorded: recordedEnvelope[field], replayed: replayed[field] })
        }
      }
      if (recordedEnvelope.cacheKey !== replayed.cacheKey) {
        // cacheKey is allowed to differ only when both are absent.
        // Absent vs present is a mismatch; two different keys is a
        // mismatch; equal keys (or both absent) is fine.
        if (recordedEnvelope.cacheKey || replayed.cacheKey) {
          mismatches.push({
            field: "cacheKey",
            recorded: recordedEnvelope.cacheKey,
            replayed: replayed.cacheKey,
          })
        }
      }

      if (argv.json) {
        process.stdout.write(
          JSON.stringify(
            {
              id: row.id,
              tool: row.tool,
              operation: row.operation,
              args: recordedArgs,
              recorded: recordedEnvelope,
              replayed,
              mismatches,
            },
            null,
            2,
          ) + EOL,
        )
        return
      }

      console.log("")
      console.log(`  audit id:    ${row.id}`)
      console.log(`  tool:        ${row.tool}`)
      console.log(`  operation:   ${row.operation}`)
      console.log(`  recorded at: ${new Date(row.time_created).toISOString()}`)
      if (row.error_code) {
        console.log(`  error_code:  ${row.error_code} (original call failed)`)
      }
      console.log("")
      console.log("  recorded envelope:")
      console.log(
        `    source=${recordedEnvelope.source} completeness=${recordedEnvelope.completeness} cacheKey=${recordedEnvelope.cacheKey ?? "-"}`,
      )
      console.log("")
      console.log("  replayed envelope:")
      console.log(
        `    source=${replayed.source} completeness=${replayed.completeness} cacheKey=${replayed.cacheKey ?? "-"}`,
      )
      console.log("")
      if (mismatches.length === 0) {
        console.log("  decision-path match: OK")
      } else {
        console.log("  decision-path mismatch:")
        for (const m of mismatches) {
          console.log(`    ${m.field}: recorded=${m.recorded} replayed=${m.replayed}`)
        }
        process.exitCode = 2
      }
    })
  },
})
