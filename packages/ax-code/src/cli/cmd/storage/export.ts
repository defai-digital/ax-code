import type { Argv } from "yargs"
import { SessionID } from "../../../session/schema"
import { cmd } from "../cmd"
import { bootstrap } from "../../bootstrap"
import { UI } from "../../ui"
import { getRequiredSession } from "../session-required"
import * as prompts from "@clack/prompts"
import { EOL } from "os"

export const ExportCommand = cmd({
  command: "export [sessionID]",
  describe: "export session data as JSON",
  builder: (yargs: Argv) => {
    return yargs.positional("sessionID", {
      describe: "session id to export",
      type: "string",
    })
  },
  handler: async (args) => {
    // Session, the replay query and transfer.ts carry the session graph;
    // load them here so `--help` never evaluates them.
    const [{ Session }, { EventQuery }, { buildTransfer }] = await Promise.all([
      import("../../../session"),
      import("../../../replay/query"),
      import("./transfer"),
    ])
    await bootstrap(process.cwd(), async () => {
      let sessionID = args.sessionID ? SessionID.make(args.sessionID) : undefined
      process.stderr.write(`Exporting session: ${sessionID ?? "latest"}\n`)

      if (!sessionID) {
        UI.empty()
        prompts.intro("Export session", {
          output: process.stderr,
        })

        const sessions = [...Session.list({ limit: Number.MAX_SAFE_INTEGER })]

        if (sessions.length === 0) {
          prompts.log.error("No sessions found", {
            output: process.stderr,
          })
          prompts.outro("Done", {
            output: process.stderr,
          })
          return
        }

        sessions.sort((a, b) => b.time.updated - a.time.updated)

        const selectedSession = await prompts.autocomplete({
          message: "Select session to export",
          maxItems: 10,
          options: sessions.map((session) => ({
            label: session.title,
            value: session.id,
            hint: `${new Date(session.time.updated).toLocaleString()} • ${session.id.slice(-8)}`,
          })),
          output: process.stderr,
        })

        if (prompts.isCancel(selectedSession)) {
          throw new UI.CancelledError()
        }

        sessionID = selectedSession

        prompts.outro("Exporting session...", {
          output: process.stderr,
        })
      }

      const sessionInfo = await getRequiredSession(sessionID!)
      try {
        const messages = await Session.messages({ sessionID: sessionInfo.id })
        const events = EventQuery.bySessionLog(sessionInfo.id)
        const exportData = buildTransfer({
          info: sessionInfo,
          messages: messages.map((msg) => ({
            info: msg.info,
            parts: msg.parts,
          })),
          events,
        })

        process.stdout.write(JSON.stringify(exportData, null, 2))
        process.stdout.write(EOL)
      } catch (error) {
        // Only a missing session is "not found"; a locked or corrupt store
        // must surface its own error.
        UI.error(`Export failed for ${sessionID!}: ${error instanceof Error ? error.message : String(error)}`)
        process.exit(1)
      }
    })
  },
})
