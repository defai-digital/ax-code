import { cmd } from "./cmd"
import { Instance } from "../../project/instance"
import { Session } from "../../session"
import { SessionBranchRank } from "../../session/branch"
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
      .option("compare", {
        describe: "Compare this session family and recommend the best branch",
        type: "boolean",
        default: false,
      })
      .option("deep", {
        describe: "Include replay divergence signals in branch comparison",
        type: "boolean",
        default: false,
      })
      .option("json", { describe: "Output as JSON", type: "boolean", default: false }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        const sessionID = SessionID.make(args.sessionID as string)
        const original = await Session.get(sessionID)

        if (args.compare) {
          const ranked = await SessionBranchRank.family(sessionID, { deep: args.deep })

          if (args.json) {
            console.log(
              JSON.stringify(
                {
                  family: { root: ranked.root.id, size: ranked.items.length },
                  recommended: {
                    id: ranked.recommended.id,
                    title: ranked.recommended.title,
                    confidence: ranked.confidence,
                    reasons: ranked.reasons,
                    semantic: ranked.recommended.semantic,
                    decision: ranked.recommended.decision,
                  },
                  sessions: ranked.items.map((item, idx) => ({
                    rank: idx + 1,
                    id: item.id,
                    title: item.title,
                    risk: item.risk,
                    decision: item.decision,
                    semantic: item.semantic,
                    plan: item.view.plan,
                    notes: item.view.notes,
                  })),
                },
                null,
                2,
              ),
            )
            return
          }

          console.log("\n  Branch Comparison")
          console.log("  " + "=".repeat(50))
          console.log("")
          console.log(`  Root: ${ranked.root.id}`)
          console.log(`        ${ranked.root.title}`)
          console.log(`  Sessions: ${ranked.items.length}`)
          console.log("")
          console.log(`  Recommended: ${ranked.recommended.id}`)
          console.log(`               ${ranked.recommended.title}`)
          if (ranked.recommended.semantic)
            console.log(`               ${ranked.recommended.semantic.headline} (${ranked.recommended.semantic.risk})`)
          console.log(`               confidence ${ranked.confidence}`)
          for (const reason of ranked.reasons) {
            console.log(`               - ${reason}`)
          }
          console.log("")

          for (const [idx, item] of ranked.items.entries()) {
            console.log(`  ${idx + 1}. ${item.id}`)
            console.log(`     ${item.title}`)
            console.log(`     ${item.headline}`)
            console.log(`     risk ${item.risk.level.toLowerCase()} (${item.risk.score}/100)`)
            if (item.semantic) console.log(`     change ${item.semantic.headline} (${item.semantic.risk})`)
            console.log(`     plan ${item.view.plan}`)
            if (item.view.notes.length > 0) console.log(`     notes ${item.view.notes.join("; ")}`)
            const why = Risk.explain(item.risk, 2)
            if (why.length > 0) console.log(`     drivers ${why.join("; ")}`)
            console.log("")
          }
          return
        }

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
