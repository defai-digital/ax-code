import { cmd } from "./cmd"
import { Instance } from "../../project/instance"
import { EventQuery } from "../../replay/query"
import { Replay } from "../../replay/replay"
import { Risk } from "../../risk/score"
import { Session } from "../../session"
import { SessionID } from "../../session/schema"
import type { ReplayEvent } from "../../replay/event"

export const CompareCommand = cmd({
  command: "compare <session1> <session2>",
  describe: "compare two session executions — decisions, diffs, and risk",
  builder: (yargs) =>
    yargs
      .positional("session1", { describe: "First session ID", type: "string", demandOption: true })
      .positional("session2", { describe: "Second session ID", type: "string", demandOption: true })
      .option("json", { describe: "Output as JSON", type: "boolean", default: false })
      .option("deep", { describe: "Step-level divergence analysis via replay comparison", type: "boolean", default: false }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        const sid1 = SessionID.make(args.session1 as string)
        const sid2 = SessionID.make(args.session2 as string)

        const [s1, s2] = await Promise.all([Session.get(sid1), Session.get(sid2)])
        const [e1, e2] = [EventQuery.bySession(sid1), EventQuery.bySession(sid2)]
        const [r1, r2] = [Risk.fromSession(sid1), Risk.fromSession(sid2)]

        const deep1 = args.deep ? Replay.compare(sid1) : undefined
        const deep2 = args.deep ? Replay.compare(sid2) : undefined

        if (args.json) {
          console.log(JSON.stringify({
            session1: { id: sid1, title: s1.title, risk: r1, events: e1.length },
            session2: { id: sid2, title: s2.title, risk: r2, events: e2.length },
            differences: diff(e1, e2),
            ...(args.deep ? {
              replay: {
                session1: { stepsCompared: deep1!.stepsCompared, divergences: deep1!.divergences.length },
                session2: { stepsCompared: deep2!.stepsCompared, divergences: deep2!.divergences.length },
              },
            } : {}),
          }, null, 2))
          return
        }

        console.log("\n  Session Comparison")
        console.log("  " + "=".repeat(60))
        console.log("")

        // Session info
        console.log(`  A: ${sid1}`)
        console.log(`     ${s1.title}`)
        console.log(`     Risk: ${r1.level} (${r1.score}/100) — ${r1.summary}`)
        console.log("")
        console.log(`  B: ${sid2}`)
        console.log(`     ${s2.title}`)
        console.log(`     Risk: ${r2.level} (${r2.score}/100) — ${r2.summary}`)
        console.log("")

        // Risk comparison
        console.log("  Risk Comparison")
        console.log("  " + "-".repeat(40))
        const riskDelta = r2.score - r1.score
        const riskArrow = riskDelta > 0 ? "\x1b[31m\u2191\x1b[0m" : riskDelta < 0 ? "\x1b[32m\u2193\x1b[0m" : "="
        console.log(`  Score: ${r1.score} \u2192 ${r2.score} (${riskDelta > 0 ? "+" : ""}${riskDelta}) ${riskArrow}`)
        console.log(`  Level: ${r1.level} \u2192 ${r2.level}`)

        const s1signals = r1.signals
        const s2signals = r2.signals
        if (s1signals.filesChanged !== s2signals.filesChanged)
          console.log(`  Files: ${s1signals.filesChanged} \u2192 ${s2signals.filesChanged}`)
        if (s1signals.toolFailures !== s2signals.toolFailures)
          console.log(`  Failures: ${s1signals.toolFailures} \u2192 ${s2signals.toolFailures}`)
        console.log("")

        // Decision path comparison
        const tools1 = extractToolChain(e1)
        const tools2 = extractToolChain(e2)
        const routes1 = extractRoutes(e1)
        const routes2 = extractRoutes(e2)

        console.log("  Decision Path")
        console.log("  " + "-".repeat(40))

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
        const counts1 = countByType(e1)
        const counts2 = countByType(e2)
        const allTypes = [...new Set([...Object.keys(counts1), ...Object.keys(counts2)])].sort()
        for (const t of allTypes) {
          const c1 = counts1[t] ?? 0
          const c2 = counts2[t] ?? 0
          if (c1 !== c2) console.log(`  ${t}: ${c1} \u2192 ${c2}`)
        }
        console.log(`  Total: ${e1.length} \u2192 ${e2.length}`)
        console.log("")

        // Deep comparison via replay
        if (args.deep && deep1 && deep2) {
          console.log("  Replay Analysis")
          console.log("  " + "-".repeat(40))
          console.log(`  Steps compared A: ${deep1.stepsCompared} | Divergences: ${deep1.divergences.length}`)
          console.log(`  Steps compared B: ${deep2.stepsCompared} | Divergences: ${deep2.divergences.length}`)

          const allDivergences = [
            ...deep1.divergences.map((d) => ({ session: "A", ...d })),
            ...deep2.divergences.map((d) => ({ session: "B", ...d })),
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

function extractToolChain(events: ReplayEvent[]): string[] {
  return events
    .filter((e): e is ReplayEvent & { type: "tool.call"; tool: string } => e.type === "tool.call")
    .map((e) => e.tool)
}

function extractRoutes(events: ReplayEvent[]): { from: string; to: string; confidence: number }[] {
  return events
    .filter((e): e is ReplayEvent & { type: "agent.route" } => e.type === "agent.route")
    .map((e) => ({ from: (e as any).fromAgent, to: (e as any).toAgent, confidence: (e as any).confidence }))
}

function countByType(events: ReplayEvent[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const e of events) counts[e.type] = (counts[e.type] ?? 0) + 1
  return counts
}

function diff(e1: ReplayEvent[], e2: ReplayEvent[]): { toolChainDiffers: boolean; routeDiffers: boolean; eventCountDelta: number } {
  const tools1 = extractToolChain(e1).join(",")
  const tools2 = extractToolChain(e2).join(",")
  const routes1 = extractRoutes(e1).map((r) => `${r.from}-${r.to}`).join(",")
  const routes2 = extractRoutes(e2).map((r) => `${r.from}-${r.to}`).join(",")
  return {
    toolChainDiffers: tools1 !== tools2,
    routeDiffers: routes1 !== routes2,
    eventCountDelta: e2.length - e1.length,
  }
}
