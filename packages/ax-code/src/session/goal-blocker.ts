import type { MessageV2 } from "./message-v2"

const ADMIN = new Set(["get_goal", "create_goal", "update_goal", "todowrite", "todoread"])

export function goalBlockerEvidence(messages: readonly MessageV2.WithParts[], since: number) {
  const latestUser = messages.findLast(
    (m) => m.info.role === "user" && m.parts.some((p) => p.type === "text" && !p.synthetic && !p.ignored),
  )
  const evidence: { id: string; kind: "user" | "tool"; tool?: string; status?: string }[] = latestUser
    ? [{ id: latestUser.info.id, kind: "user" }]
    : []
  for (const message of messages) {
    if (message.info.role !== "assistant") continue
    for (const part of message.parts) {
      if (part.type !== "tool" || ADMIN.has(part.tool)) continue
      if (part.state.status !== "completed" && part.state.status !== "error") continue
      // Scope by when the tool actually finished, not when the enclosing
      // assistant message started. A message that creates the goal and then
      // runs a failing command has `time.created` before the goal, so a
      // message-level cutoff would drop evidence the model is required to cite.
      if (part.state.time.end < since) continue
      evidence.push({ id: part.id, kind: "tool", tool: part.tool, status: part.state.status })
    }
  }
  return evidence
}
