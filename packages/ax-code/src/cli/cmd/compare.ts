import { cmd } from "./cmd"
import { Instance } from "../../project/instance"
import { Risk } from "../../risk/score"
import { SessionCompare } from "../../session/compare"
import { SessionID } from "../../session/schema"

export namespace CompareView {
  export function decisionLines(input: SessionCompare.Result) {
    const out = [
      "",
      "  Decision Diff",
      "  " + "-".repeat(40),
      `  Recommendation: ${input.decision.recommendation}`,
      `  Confidence:     ${input.decision.confidence}`,
      "",
      `  A: ${input.decision.session1.title}`,
      `     ${[input.decision.session1.plan, input.decision.session1.change, input.decision.session1.validation].filter(Boolean).join(" · ")}`,
      `     ${input.decision.session1.headline}`,
      "",
      `  B: ${input.decision.session2.title}`,
      `     ${[input.decision.session2.plan, input.decision.session2.change, input.decision.session2.validation].filter(Boolean).join(" · ")}`,
      `     ${input.decision.session2.headline}`,
      "",
      "  Signals",
      "  " + "-".repeat(40),
    ]

    for (const item of input.decision.differences) out.push(`  - ${item}`)
    if (input.decision.reasons.length > 0) {
      out.push("")
      out.push("  Reasons")
      out.push("  " + "-".repeat(40))
      for (const item of input.decision.reasons) out.push(`  - ${item}`)
    }
    out.push("")
    return out
  }
}

export const CompareCommand = cmd({
  command: "compare <session1> <session2>",
  describe: "compare two session executions — decisions, diffs, and risk",
  builder: (yargs) =>
    yargs
      .positional("session1", { describe: "First session ID", type: "string", demandOption: true })
      .positional("session2", { describe: "Second session ID", type: "string", demandOption: true })
      .option("json", { describe: "Output as JSON", type: "boolean", default: false })
      .option("decision", {
        describe: "Show decision-level recommendation output",
        type: "boolean",
        default: false,
      })
      .option("deep", {
        describe: "Step-level divergence analysis via replay comparison",
        type: "boolean",
        default: false,
      }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        const sid1 = SessionID.make(args.session1 as string)
        const sid2 = SessionID.make(args.session2 as string)
        const result = await SessionCompare.compare({
          sessionID: sid1,
          otherSessionID: sid2,
          deep: args.deep,
        })

        if (args.json) {
          console.log(JSON.stringify(args.decision ? result.decision : result, null, 2))
          return
        }

        if (args.decision) {
          console.log(CompareView.decisionLines(result).join("\n"))
          return
        }

        const r1 = result.session1.risk
        const r2 = result.session2.risk
        const card1 = result.session1.decision
        const card2 = result.session2.decision
        const view1 = result.analysis.session1
        const view2 = result.analysis.session2

        console.log("\n  Session Comparison")
        console.log("  " + "=".repeat(60))
        console.log("")

        // Session info
        console.log(`  A: ${result.session1.id}`)
        console.log(`     ${result.session1.title}`)
        console.log(`     Risk: ${r1.level} (${r1.score}/100) — ${r1.summary}`)
        if (result.session1.semantic) console.log(`     Change: ${result.session1.semantic.headline} (${result.session1.semantic.risk})`)
        console.log("")
        console.log(`  B: ${result.session2.id}`)
        console.log(`     ${result.session2.title}`)
        console.log(`     Risk: ${r2.level} (${r2.score}/100) — ${r2.summary}`)
        if (result.session2.semantic) console.log(`     Change: ${result.session2.semantic.headline} (${result.session2.semantic.risk})`)
        console.log("")

        // Risk comparison
        console.log("  Risk Comparison")
        console.log("  " + "-".repeat(40))
        const riskDelta = result.session2.risk.score - result.session1.risk.score
        const riskArrow = riskDelta > 0 ? "\x1b[31m\u2191\x1b[0m" : riskDelta < 0 ? "\x1b[32m\u2193\x1b[0m" : "="
        console.log(`  Score: ${r1.score} \u2192 ${r2.score} (${riskDelta > 0 ? "+" : ""}${riskDelta}) ${riskArrow}`)
        console.log(`  Level: ${r1.level} \u2192 ${r2.level}`)

        const s1signals = r1.signals
        const s2signals = r2.signals
        if (s1signals.filesChanged !== s2signals.filesChanged)
          console.log(`  Files: ${s1signals.filesChanged} \u2192 ${s2signals.filesChanged}`)
        if (s1signals.toolFailures !== s2signals.toolFailures)
          console.log(`  Failures: ${s1signals.toolFailures} \u2192 ${s2signals.toolFailures}`)
        const why1 = Risk.explain(r1 as Parameters<typeof Risk.explain>[0], 2)
        const why2 = Risk.explain(r2 as Parameters<typeof Risk.explain>[0], 2)
        if (why1.length > 0) console.log(`  Drivers A: ${why1.join("; ")}`)
        if (why2.length > 0) console.log(`  Drivers B: ${why2.join("; ")}`)
        console.log("")

        console.log("  Decision Score")
        console.log("  " + "-".repeat(40))
        console.log(
          `  A: ${card1.total.toFixed(2)} (${card1.breakdown.map((item) => `${item.key} ${item.value.toFixed(2)}`).join("; ")})`,
        )
        console.log(
          `  B: ${card2.total.toFixed(2)} (${card2.breakdown.map((item) => `${item.key} ${item.value.toFixed(2)}`).join("; ")})`,
        )
        console.log(`  Delta: ${(card1.total - card2.total).toFixed(2)}`)
        console.log("")

        console.log(CompareView.decisionLines(result).join("\n"))

        // Decision path comparison
        const tools1 = view1.tools
        const tools2 = view2.tools
        const routes1 = view1.routes
        const routes2 = view2.routes

        console.log("  Decision Path")
        console.log("  " + "-".repeat(40))
        console.log(`  Plan A: ${view1.plan}`)
        console.log(`  Plan B: ${view2.plan}`)
        if (result.session1.semantic) console.log(`  Change A: ${result.session1.semantic.headline}`)
        if (result.session2.semantic) console.log(`  Change B: ${result.session2.semantic.headline}`)
        if (view1.notes.length > 0) console.log(`  Notes A: ${view1.notes.join("; ")}`)
        if (view2.notes.length > 0) console.log(`  Notes B: ${view2.notes.join("; ")}`)
        console.log("")

        if (routes1.length > 0 || routes2.length > 0) {
          console.log(`  Routes A: ${routes1.map((r) => `${r.from}\u2192${r.to}`).join(", ") || "none"}`)
          console.log(`  Routes B: ${routes2.map((r) => `${r.from}\u2192${r.to}`).join(", ") || "none"}`)
        }

        console.log(`  Tools A: ${tools1.join(" \u2192 ") || "none"} (${tools1.length} calls)`)
        console.log(`  Tools B: ${tools2.join(" \u2192 ") || "none"} (${tools2.length} calls)`)
        console.log("")

        // Event count summary
        console.log("  Event Summary")
        console.log("  " + "-".repeat(40))
        const counts1 = view1.counts
        const counts2 = view2.counts
        const allTypes = [...new Set([...Object.keys(counts1), ...Object.keys(counts2)])].sort()
        for (const t of allTypes) {
          const c1 = counts1[t] ?? 0
          const c2 = counts2[t] ?? 0
          if (c1 !== c2) console.log(`  ${t}: ${c1} \u2192 ${c2}`)
        }
        console.log(`  Total: ${result.session1.events} \u2192 ${result.session2.events}`)
        console.log("")

        console.log("  Advisory")
        console.log("  " + "-".repeat(40))
        if (result.advisory.winner === "tie") {
          console.log(`  Result: No clear winner (confidence: ${result.advisory.confidence})`)
        } else {
          console.log(`  Prefer: ${result.advisory.winner} (confidence: ${result.advisory.confidence})`)
        }
        for (const reason of result.advisory.reasons) {
          console.log(`  - ${reason}`)
        }
        console.log("")

        // Deep comparison via replay
        if (args.deep && result.replay) {
          console.log("  Replay Analysis")
          console.log("  " + "-".repeat(40))
          console.log(
            `  Steps compared A: ${result.replay.session1.stepsCompared} | Divergences: ${result.replay.session1.divergences}`,
          )
          console.log(
            `  Steps compared B: ${result.replay.session2.stepsCompared} | Divergences: ${result.replay.session2.divergences}`,
          )

          const allDivergences = [
            ...result.replay.session1.reasons.map((reason, idx) => ({ session: "A", sequence: idx, reason })),
            ...result.replay.session2.reasons.map((reason, idx) => ({ session: "B", sequence: idx, reason })),
          ]
          if (allDivergences.length > 0) {
            console.log("")
            console.log("  Divergences:")
            for (const d of allDivergences) {
              console.log(`    [${d.session}] seq=${d.sequence}: ${d.reason}`)
            }
          }
          console.log("")
        }
      },
    })
  },
})
