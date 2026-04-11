import { cmd } from "./cmd"
import { Instance } from "../../project/instance"
import { Session } from "../../session"
import { SessionID } from "../../session/schema"
import { SessionSemanticDiff } from "../../session/semantic-diff"

export const DiffCommand = cmd({
  command: "diff <sessionID>",
  describe: "inspect session file changes and semantic change classification",
  builder: (yargs) =>
    yargs
      .positional("sessionID", { describe: "Session ID", type: "string", demandOption: true })
      .option("semantic", {
        describe: "Show semantic change classification instead of raw file churn",
        type: "boolean",
        default: false,
      })
      .option("json", { describe: "Output as JSON", type: "boolean", default: false }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        const sessionID = SessionID.make(args.sessionID as string)
        await Session.get(sessionID)
        const diff = await Session.diff(sessionID)
        const semantic = SessionSemanticDiff.summarize(diff) ?? null

        if (args.json) {
          console.log(JSON.stringify(args.semantic ? { semantic, diff } : diff, null, 2))
          return
        }

        if (diff.length === 0) {
          console.log("\n  No recorded file changes.\n")
          return
        }

        if (args.semantic) {
          console.log("\n  Semantic Diff")
          console.log("  " + "=".repeat(50))
          console.log("")
          if (!semantic) {
            console.log("  No semantic summary available.")
            console.log("")
            return
          }
          console.log(`  Headline: ${semantic.headline}`)
          console.log(`  Primary:  ${SessionSemanticDiff.format(semantic.primary)}`)
          console.log(`  Risk:     ${semantic.risk}`)
          console.log(`  Totals:   ${semantic.files} files · +${semantic.additions} / -${semantic.deletions}`)
          if (semantic.signals.length > 0) console.log(`  Signals:  ${semantic.signals.join("; ")}`)
          console.log("")
          for (const item of semantic.changes) {
            console.log(`  - ${item.summary}`)
            console.log(
              `    ${item.risk} risk · +${item.additions} / -${item.deletions}${item.status ? ` · ${item.status}` : ""}`,
            )
            if (item.signals.length > 0) console.log(`    ${item.signals.join("; ")}`)
          }
          console.log("")
          return
        }

        console.log("\n  Session Diff")
        console.log("  " + "=".repeat(50))
        console.log("")
        for (const item of diff) {
          const status = item.status ?? "modified"
          console.log(`  - ${item.file}`)
          console.log(`    ${status} · +${item.additions} / -${item.deletions}`)
        }
        const additions = diff.reduce((sum, item) => sum + item.additions, 0)
        const deletions = diff.reduce((sum, item) => sum + item.deletions, 0)
        console.log("")
        console.log(`  Totals: ${diff.length} files · +${additions} / -${deletions}`)
        console.log("")
      },
    })
  },
})
