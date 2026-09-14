import { createHash } from "node:crypto"
import { GoalCheckVerification } from "./goal-check-verification"
import type { MessageV2 } from "./message-v2"

const MUTATIONS = new Set(["write", "edit", "apply_patch", "multiedit", "patch"])
const goalPlanPath = (value: string) => /(?:^|[\\/])\.ax-code[\\/]goals(?:[\\/]|$)/.test(value)
const ADMIN = new Set(["get_goal", "create_goal", "update_goal", "todowrite", "todoread"])

/** Reconstruct progress from original durable records; summaries and checklist churn are not evidence. */
export function goalProgress(messages: readonly MessageV2.WithParts[], since: number) {
  const seen = new Set<string>()
  let stagnant = 0
  let progress = false
  for (const message of messages) {
    if (message.info.time.created < since) continue
    if (message.info.role === "user") {
      if (message.parts.some((p) => p.type === "text" && !p.synthetic && !p.ignored)) {
        stagnant = 0
        progress = false
      }
      continue
    }
    if (message.info.summary) continue
    for (const part of message.parts) {
      if (part.type === "patch") {
        const owned = part.files.filter((file) => !part.externalFiles?.includes(file) && !goalPlanPath(file))
        if (owned.length) {
          const signature = `patch:${part.hash}:${owned.slice().sort().join(";")}`
          if (!seen.has(signature)) {
            seen.add(signature)
            progress = true
          }
        }
      }
      if (part.type !== "tool" || ADMIN.has(part.tool) || part.state.status !== "completed") continue
      const metadata = part.state.metadata
      if (
        metadata?.passed === false ||
        metadata?.allPassed === false ||
        (typeof metadata?.exit === "number" && metadata.exit !== 0)
      )
        continue
      const file = part.state.input.filePath ?? part.state.input.filepath ?? part.state.input.path
      if (typeof file === "string" && goalPlanPath(file)) continue
      if (part.tool === "apply_patch" && typeof part.state.input.patchText === "string") {
        const paths = [
          ...part.state.input.patchText.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm),
        ].map((match) => match[1].trim())
        if (paths.length && paths.every(goalPlanPath)) continue
      }
      // Pruning retains original stored output; the compacted flag only
      // suppresses model projection, so durable evidence remains usable here.
      const output = part.state.output.trim()
      if (!output) continue
      // Result-based novelty lets research advance without editing files and
      // prevents argument/checklist churn alone from renewing the budget.
      const receipt =
        part.tool === "verify_project"
          ? GoalCheckVerification.ReceiptSchema.safeParse(metadata?.goalCheckReceipt)
          : undefined
      // Verification durations, timestamps and envelope IDs are not new evidence.
      const evidence =
        part.tool === "verify_project"
          ? JSON.stringify({
              input: part.state.input,
              commands: metadata?.commands,
              source: receipt?.success ? receipt.data.sourceAfter : undefined,
            })
          : output
      const signature = createHash("sha256")
        .update(part.tool)
        .update(evidence)
        .update(MUTATIONS.has(part.tool) ? JSON.stringify(part.state.input) : "")
        .digest("hex")
      if (!seen.has(signature)) {
        seen.add(signature)
        progress = true
      }
    }
    if (message.info.finish && !["tool-calls", "unknown", "length"].includes(message.info.finish)) {
      stagnant = progress ? 0 : stagnant + 1
      progress = false
    }
  }
  return { stagnant, action: stagnant >= 4 ? "pause" : stagnant >= 2 ? "recover" : "continue" } as const
}
