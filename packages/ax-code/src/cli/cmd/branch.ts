import { cmd } from "./cmd"
import { Instance } from "../../project/instance"
import { Session } from "../../session"
import { SessionID, MessageID } from "../../session/schema"
import { Risk } from "../../risk/score"
import { Snapshot } from "../../snapshot"

export const BranchCommand = cmd({
  command: "branch <sessionID>",
  describe: "create an execution branch from a session to try a different strategy",
  builder: (yargs) =>
    yargs
      .positional("sessionID", { describe: "Session to branch from", type: "string", demandOption: true })
      .option("from", { describe: "Branch from a specific message ID (defaults to latest)", type: "string" })
      .option("json", { describe: "Output as JSON", type: "boolean", default: false }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        const sessionID = SessionID.make(args.sessionID as string)
        const original = await Session.get(sessionID)
        const risk = Risk.fromSession(sessionID)

        // Snapshot current state before branching
        const snapshotHash = await Snapshot.track().catch(() => undefined)

        // Fork the session
        const messageID = args.from ? MessageID.make(args.from as string) : undefined
        const forked = await Session.fork({ sessionID, messageID })

        const forkedRisk = Risk.fromSession(forked.id)

        if (args.json) {
          console.log(
            JSON.stringify(
              {
                original: { id: sessionID, title: original.title, risk },
                branch: { id: forked.id, title: forked.title, risk: forkedRisk },
                snapshot: snapshotHash,
                branchedFrom: messageID ?? "latest",
              },
              null,
              2,
            ),
          )
          return
        }

        console.log("\n  Branch Created")
        console.log("  " + "=".repeat(50))
        console.log("")
        console.log(`  Original: ${sessionID}`)
        console.log(`            ${original.title}`)
        console.log(`            Risk: ${risk.level} (${risk.score}/100)`)
        console.log("")
        console.log(`  Branch:   ${forked.id}`)
        console.log(`            ${forked.title}`)
        if (messageID) console.log(`            Branched from message: ${messageID}`)
        if (snapshotHash) console.log(`            Snapshot: ${snapshotHash.slice(0, 12)}...`)
        console.log("")
        console.log("  Next steps:")
        console.log(`    ax-code run --session ${forked.id} "your new prompt"`)
        console.log(`    ax-code compare ${sessionID} ${forked.id}`)
        if (snapshotHash) console.log(`    ax-code rollback ${forked.id}`)
        console.log("")
      },
    })
  },
})
