import { cmd } from "./cmd"
import { Instance } from "../../project/instance"
import { SessionRisk } from "../../session/risk"
import { SessionID } from "../../session/schema"

export namespace RiskView {
  function validation(input: SessionRisk.Detail["assessment"]["signals"]) {
    if (input.validationState === "passed") return "validation passed"
    if (input.validationState === "failed") return "validation failed"
    if (input.validationState === "partial") return "partial validation"
    return "validation unrecorded"
  }

  export function lines(input: SessionRisk.Detail, explain = false) {
    const out = [
      "",
      "  Session Risk",
      "  " + "=".repeat(50),
      "",
      `  Session: ${input.id}`,
      `  Title:   ${input.title}`,
      `  Risk:    ${input.assessment.level} (${input.assessment.score}/100)`,
      `  Ready:   ${input.assessment.readiness.replaceAll("_", " ")}`,
      `  Confidence: ${Math.round(input.assessment.confidence * 100)}%`,
      `  Summary: ${input.assessment.summary}`,
    ]
    if (input.semantic) out.push(`  Change:  ${input.semantic.headline} (${input.semantic.risk})`)

    const sig = input.assessment.signals
    const scope = [
      `${sig.filesChanged} files`,
      `${sig.linesChanged} lines`,
      `${sig.totalTools} tools`,
      sig.apiEndpointsAffected > 0 ? `${sig.apiEndpointsAffected} routes` : "",
      sig.crossModule ? "cross-module" : "",
      sig.securityRelated ? "security-sensitive" : "",
      validation(sig),
      sig.diffState,
    ]
      .filter(Boolean)
      .join(" \u00b7 ")
    out.push(`  Scope:   ${scope}`)

    if (input.drivers.length > 0) {
      out.push("")
      out.push("  Drivers")
      out.push("  " + "-".repeat(40))
      for (const item of input.drivers) out.push(`  - ${item}`)
    }

    if (explain) {
      out.push("")
      out.push("  Breakdown")
      out.push("  " + "-".repeat(40))
      if (input.assessment.breakdown.length === 0) out.push("  - No elevated risk drivers recorded.")
      for (const item of input.assessment.breakdown) {
        out.push(`  - ${item.label}: ${item.detail} (+${item.points})`)
      }

      if (input.assessment.evidence.length > 0) {
        out.push("")
        out.push("  Evidence")
        out.push("  " + "-".repeat(40))
        for (const item of input.assessment.evidence) out.push(`  - ${item}`)
      }

      if (input.assessment.unknowns.length > 0) {
        out.push("")
        out.push("  Unknowns")
        out.push("  " + "-".repeat(40))
        for (const item of input.assessment.unknowns) out.push(`  - ${item}`)
      }

      if (input.assessment.mitigations.length > 0) {
        out.push("")
        out.push("  Mitigations")
        out.push("  " + "-".repeat(40))
        for (const item of input.assessment.mitigations) out.push(`  - ${item}`)
      }
    }

    out.push("")
    return out
  }
}

export const RiskCommand = cmd({
  command: "risk <sessionID>",
  describe: "inspect explainable risk detail for a session",
  builder: (yargs) =>
    yargs
      .positional("sessionID", { describe: "Session ID", type: "string", demandOption: true })
      .option("explain", {
        describe: "Show the full risk breakdown",
        type: "boolean",
        default: false,
      })
      .option("json", { describe: "Output as JSON", type: "boolean", default: false }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        const sessionID = SessionID.make(args.sessionID as string)
        const detail = await SessionRisk.load(sessionID)

        if (args.json) {
          console.log(JSON.stringify(detail, null, 2))
          return
        }

        console.log(RiskView.lines(detail, args.explain).join("\n"))
      },
    })
  },
})
