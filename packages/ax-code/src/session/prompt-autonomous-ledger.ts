import type { MessageV2 } from "./message-v2"

function safeDecisionText(value: unknown, max = 240) {
  if (typeof value !== "string") return ""
  const escaped = value
    .replace(/\s+/g, " ")
    .trim()
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
  return escaped.length <= max ? escaped : `${escaped.slice(0, max)}...`
}

export function autonomousDecisionLedgerReminder(messages: MessageV2.WithParts[]) {
  const lines: string[] = []
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== "tool") continue
      if (part.tool !== "question") continue
      if (part.state.status !== "completed") continue
      const metadata = part.state.metadata
      if (!metadata || typeof metadata !== "object") continue
      const decisions = metadata["autonomousDecisions"]
      if (!Array.isArray(decisions)) continue
      for (const decision of decisions) {
        if (!decision || typeof decision !== "object") continue
        const value = decision as Record<string, unknown>
        const selected = Array.isArray(value["selected"])
          ? value["selected"]
              .map((item) => safeDecisionText(item, 120))
              .filter(Boolean)
              .join(", ")
          : ""
        const header = safeDecisionText(value["header"], 80)
        const question = safeDecisionText(value["question"], 180)
        const confidence = safeDecisionText(value["confidence"], 32)
        const rationale = safeDecisionText(value["rationale"], 240)
        lines.push(
          `- ${header ? `[${header}] ` : ""}${question || "Question"} -> ${selected || "Unanswered"}${
            confidence ? ` (${confidence} confidence)` : ""
          }${rationale ? `; ${rationale}` : ""}`,
        )
        if (lines.length >= 12) break
      }
      if (lines.length >= 12) break
    }
    if (lines.length >= 12) break
  }
  if (lines.length === 0) return
  return [
    "<autonomous_decision_ledger>",
    "Autonomous mode made these user-visible choices earlier in this session. Use this ledger when preparing the final response.",
    ...lines,
    "</autonomous_decision_ledger>",
  ].join("\n")
}
