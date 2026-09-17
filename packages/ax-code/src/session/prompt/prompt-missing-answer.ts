import type { MessageV2 } from "../message-v2"

// A stop with only reasoning is not a user-facing completion. Never replay
// a turn that already issued a tool, even if the provider mislabeled it stop.
export function isMissingAnswer(parts: readonly MessageV2.Part[]): boolean {
  return !parts.some(
    (part) =>
      part.type === "tool" ||
      part.type === "file" ||
      (part.type === "text" && !part.ignored && !part.synthetic && part.text.trim().length > 0),
  )
}

export const MISSING_ANSWER_RECOVERY =
  "Response recovery: the previous turn ended without a user-facing answer or a real tool call. " +
  "Answer the latest user request now. If tools are available and needed, use the actual tool protocol. " +
  "Tool markup inside reasoning or plain text does not execute. Do not repeat hidden reasoning as the answer. " +
  "Earlier checkpoint instructions applied only to their designated turn; follow the current tool availability."

// Historical loop controls are not standing user instructions. Keep the
// transcript intact, but expire these synthetic controls after a newer user
// or control-plane continuation. Real user text is never removed.
export function projectCurrentLoopControls(messages: MessageV2.WithParts[]): MessageV2.WithParts[] {
  const lastUserIndex = messages.findLastIndex((message) => message.info.role === "user")
  return messages.flatMap((message, index) => {
    if (index >= lastUserIndex || message.info.role !== "user") return [message]
    const parts = message.parts.filter(
      (part) =>
        !(
          part.type === "text" &&
          part.synthetic &&
          (part.text.startsWith("Agent-loop checkpoint:") ||
            part.text.startsWith("Local-engine convergence checkpoint:"))
        ),
    )
    if (parts.length === message.parts.length) return [message]
    return parts.length ? [{ ...message, parts }] : []
  })
}
