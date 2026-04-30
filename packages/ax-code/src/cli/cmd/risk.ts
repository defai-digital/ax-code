import { cmd } from "./cmd"
import { Instance } from "../../project/instance"
import { SessionRisk } from "../../session/risk"
import { SessionID } from "../../session/schema"
import { ProbabilisticRollout } from "../../quality/probabilistic-rollout"

export namespace RiskView {
  type ReplayReadinessSummary = NonNullable<SessionRisk.QualityReadiness["review"]>
  type DecisionHintSummary = NonNullable<SessionRisk.Detail["decisionHints"]>
  type ReviewResult = NonNullable<SessionRisk.Detail["reviewResults"]>[number]

  function validation(input: SessionRisk.Detail["assessment"]["signals"]) {
    if (input.validationState === "passed") return "validation passed"
    if (input.validationState === "failed") return "validation failed"
    if (input.validationState === "partial") return "partial validation"
    return "validation unrecorded"
  }

  function qualityLine(workflow: "review" | "debug" | "qa", summary: ReplayReadinessSummary) {
    const readiness = ProbabilisticRollout.readinessStateLabel(summary)
    const detail = ProbabilisticRollout.readinessDetailLabel(summary)
    const recommended = ProbabilisticRollout.targetedTestRecommendations(summary)[0]
    const first = recommended ? ` · first: ${recommended}` : ""
    const nextAction = ProbabilisticRollout.readinessNextActionLabel(summary)
    const next = nextAction ? ` · next: ${nextAction}` : ""
    return `  ${workflow}: ${readiness} · ${detail}${first}${next}`
  }

  function decisionHintReadiness(summary: DecisionHintSummary) {
    if (summary.readiness === "blocked") return "blocked by failed validation"
    if (summary.readiness === "needs_validation") return "needs validation"
    return "clear"
  }

  function reviewDecisionLabel(decision: ReviewResult["decision"]) {
    return decision.replaceAll("_", " ")
  }

  function reviewResultLine(result: ReviewResult) {
    const blocking = result.blockingFindingIds.length
    const findings = result.counts.total
    const checks = result.missingVerification
      ? "verification needed"
      : `${result.verificationEnvelopeIds.length} verification envelope${result.verificationEnvelopeIds.length === 1 ? "" : "s"}`
    const recommendation =
      result.decision === result.recommendedDecision
        ? ""
        : ` · recommended: ${reviewDecisionLabel(result.recommendedDecision)}`
    return `  ${reviewDecisionLabel(result.decision)} · ${findings} finding${findings === 1 ? "" : "s"} · ${blocking} blocking · ${checks}${recommendation}`
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

    const readinessLines = [
      input.quality?.review ? qualityLine("review", input.quality.review) : null,
      input.quality?.debug ? qualityLine("debug", input.quality.debug) : null,
      input.quality?.qa ? qualityLine("qa", input.quality.qa) : null,
    ].filter((line): line is string => !!line)

    if (readinessLines.length > 0) {
      out.push("")
      out.push("  Quality Readiness")
      out.push("  " + "-".repeat(40))
      out.push(...readinessLines)
    }

    if (input.reviewResults && input.reviewResults.length > 0) {
      out.push("")
      out.push("  Review Result")
      out.push("  " + "-".repeat(40))
      out.push(reviewResultLine(input.reviewResults.at(-1)!))
    }

    if (input.decisionHints) {
      out.push("")
      out.push("  Decision Hints")
      out.push("  " + "-".repeat(40))
      out.push(
        `  ${decisionHintReadiness(input.decisionHints)} · ${input.decisionHints.hintCount} hints · ${input.decisionHints.actionCount} recent tool results · ${input.decisionHints.source}`,
      )
      for (const hint of input.decisionHints.hints) {
        out.push(`  - ${hint.title} (${Math.round(hint.confidence * 100)}%): ${hint.body}`)
        const evidence = hint.evidence.slice(0, 3)
        for (const item of evidence) out.push(`    evidence: ${item}`)
        if (hint.evidence.length > evidence.length) {
          out.push(`    evidence: +${hint.evidence.length - evidence.length} more`)
        }
      }
    }

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
      .option("quality", {
        describe: "Include review/debug/qa replay readiness when replay evidence exists",
        type: "boolean",
        default: true,
      })
      .option("hints", {
        describe: "Include advisory decision hints from recent replay evidence",
        type: "boolean",
        default: true,
      })
      .option("review-results", {
        describe: "Include structured review completion results when present",
        type: "boolean",
        default: true,
      })
      .option("json", { describe: "Output as JSON", type: "boolean", default: false }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        const sessionID = SessionID.make(args.sessionID as string)
        const detail = await SessionRisk.load(sessionID, {
          includeQuality: Boolean(args.quality),
          includeDecisionHints: Boolean(args.hints),
          includeReviewResults: Boolean(args.reviewResults),
        })

        if (args.json) {
          console.log(JSON.stringify(detail, null, 2))
          return
        }

        console.log(RiskView.lines(detail, args.explain).join("\n"))
      },
    })
  },
})
