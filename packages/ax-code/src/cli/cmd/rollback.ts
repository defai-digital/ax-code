import { cmd } from "./cmd"
import { Instance } from "../../project/instance"
import { Session } from "../../session"
import { SessionID } from "../../session/schema"
import { SessionRevert } from "../../session/revert"
import { SessionRollback } from "../../session/rollback"
import { Risk } from "../../risk/score"
import { getRequiredSession } from "./session-required"

export const RollbackCommand = cmd({
  command: "rollback <sessionID>",
  describe: "rollback file changes from a session",
  builder: (yargs) =>
    yargs
      .positional("sessionID", { describe: "Session to rollback", type: "string", demandOption: true })
      .option("dry-run", {
        describe: "Show what would be rolled back without applying",
        type: "boolean",
        default: false,
      })
      .option("force", { describe: "Skip confirmation", type: "boolean", default: false })
      .option("list", {
        describe: "Show available rollback points from the execution graph",
        type: "boolean",
        default: false,
      })
      .option("step", { describe: "Rollback to a specific step index instead of the full session", type: "number" }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        const sessionID = SessionID.make(args.sessionID as string)
        const session = await getRequiredSession(sessionID, args.sessionID as string)
        const risk = Risk.fromSession(sessionID)

        console.log(`\nSession: ${sessionID}`)
        console.log(`Title: ${session.title}`)
        console.log(`Risk: ${risk.level} (${risk.score}/100)`)

        // --list: show rollback points from execution graph
        if (args.list) {
          const availablePoints = await SessionRollback.points(sessionID)
          if (availablePoints.length === 0) {
            console.log("\nNo steps found in session.")
            return
          }

          console.log(`\nRollback points (${availablePoints.length} steps):`)
          for (const point of availablePoints) {
            const dur = point.duration != null ? ` (${point.duration}ms)` : ""
            const tok = point.tokens ? ` tokens: ${point.tokens.input}/${point.tokens.output}` : ""
            const toolSummary = point.tools.length > 0 ? ` [${point.tools.join(", ")}]` : ""
            console.log(`  Step #${point.step}${dur}${tok}${toolSummary}`)
          }
          console.log(`\nUsage: ax-code rollback ${sessionID} --step <N>`)
          return
        }

        const msgs = await Session.messages({ sessionID })
        if (msgs.length === 0) {
          console.log("No messages in session.")
          return
        }

        let target: SessionRevert.RevertInput
        if (args.step != null) {
          const step = args.step as number
          const point = SessionRollback.pick({ points: await SessionRollback.points(sessionID), step })
          if (!point) {
            console.log(`\nStep #${step} not found. Use --list to see available steps.`)
            return
          }
          target = {
            sessionID,
            messageID: point.messageID,
            partID: point.partID,
          }
        } else {
          const firstAssistant = msgs.find((message) => message.info.role === "assistant")
          if (!firstAssistant) {
            console.log("No assistant messages to rollback.")
            return
          }
          target = {
            sessionID,
            messageID: firstAssistant.info.id,
          }
        }

        const preview = await SessionRevert.preview(target)
        const diff = preview.diffs

        if (!diff || diff.length === 0) {
          // The rollback set comes from recorded snapshots/diffs. If no diff was
          // recorded but the session's tool events show files were changed, those
          // changes are real yet unrecoverable here — typically because the
          // project is not a git repository, so snapshots are disabled. Surface
          // that clearly and fail instead of reporting a misleading clean
          // "nothing to roll back" success. See #254.
          if (risk.signals.filesChanged > 0) {
            const n = risk.signals.filesChanged
            console.log(
              `\n\x1b[31mDetected ${n} changed file${n === 1 ? "" : "s"}, but no rollback snapshot was recorded for this session.\x1b[0m`,
            )
            console.log(
              "Rollback relies on snapshots, which are only captured for git-tracked projects. These changes cannot be rolled back automatically.",
            )
            process.exitCode = 1
            return
          }
          console.log("\nNo file changes to rollback.")
          return
        }

        console.log(`\nFiles to rollback (${diff.length}):`)
        for (const d of diff) {
          const status =
            d.status === "added" ? "\x1b[32m+\x1b[0m" : d.status === "deleted" ? "\x1b[31m-\x1b[0m" : "\x1b[33m~\x1b[0m"
          console.log(`  ${status} ${d.file} (+${d.additions} -${d.deletions})`)
        }

        if (preview.descendants.length > 0) {
          console.log(`\nDelegated sessions included (${preview.descendants.length}):`)
          for (const item of preview.descendants) {
            console.log(`  ${item.sessionID}: ${item.files.join(", ")}`)
          }
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

        await SessionRollback.apply(target)
        console.log(
          args.step != null
            ? `\n\x1b[32mRolled back to step #${args.step}.\x1b[0m`
            : `\n\x1b[32mRolled back ${diff.length} files.\x1b[0m`,
        )
      },
    })
  },
})
