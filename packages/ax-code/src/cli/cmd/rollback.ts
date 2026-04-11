import { cmd } from "./cmd"
import { Instance } from "../../project/instance"
import { Session } from "../../session"
import { SessionID } from "../../session/schema"
import { SessionRevert } from "../../session/revert"
import { Risk } from "../../risk/score"

export const RollbackCommand = cmd({
  command: "rollback <sessionID>",
  describe: "rollback all file changes from a session",
  builder: (yargs) =>
    yargs
      .positional("sessionID", { describe: "Session to rollback", type: "string", demandOption: true })
      .option("dry-run", { describe: "Show what would be rolled back without applying", type: "boolean", default: false })
      .option("force", { describe: "Skip confirmation", type: "boolean", default: false }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        const sessionID = SessionID.make(args.sessionID as string)
        const session = await Session.get(sessionID)
        const risk = Risk.fromSession(sessionID)
        const diff = await Session.diff(sessionID)

        console.log(`\nSession: ${sessionID}`)
        console.log(`Title: ${session.title}`)
        console.log(`Risk: ${risk.level} (${risk.score}/100)`)

        if (!diff || diff.length === 0) {
          console.log("\nNo file changes to rollback.")
          return
        }

        console.log(`\nFiles to rollback (${diff.length}):`)
        for (const d of diff) {
          const status = d.status === "added" ? "\x1b[32m+\x1b[0m" :
                         d.status === "deleted" ? "\x1b[31m-\x1b[0m" :
                         "\x1b[33m~\x1b[0m"
          console.log(`  ${status} ${d.file} (+${d.additions} -${d.deletions})`)
        }

        if (args.dryRun) {
          console.log("\n(dry run — no changes applied)")
          return
        }

        if (!args.force) {
          const readline = await import("readline")
          const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
          const answer = await new Promise<string>((resolve) => {
            rl.question("\nProceed with rollback? (y/N) ", resolve)
          })
          rl.close()
          if (answer.toLowerCase() !== "y") {
            console.log("Cancelled.")
            return
          }
        }

        // Get all messages to find the first one for revert point
        const msgs = await Session.messages({ sessionID })
        if (msgs.length === 0) {
          console.log("No messages in session.")
          return
        }

        // Revert to before the first assistant message
        const firstAssistant = msgs.find((m) => m.info.role === "assistant")
        if (!firstAssistant) {
          console.log("No assistant messages to rollback.")
          return
        }

        await SessionRevert.revert({
          sessionID,
          messageID: firstAssistant.info.id,
        })
        await SessionRevert.cleanup(session)

        console.log(`\n\x1b[32mRolled back ${diff.length} files.\x1b[0m`)
      },
    })
  },
})
