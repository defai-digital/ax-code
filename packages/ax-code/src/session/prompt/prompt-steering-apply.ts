import type { MessageV2 } from "../message-v2"
import type { MessageID, SessionID } from "../schema"
import { createUserMessage } from "./prompt-user-message"

/**
 * Commit one drained steer as a durable user message, inheriting the execution
 * settings of the message the user was steering.
 *
 * Extracted from the prompt loop so the contract this function depends on is
 * covered by an integration test through the real write path: the admission
 * object's `beforeCommit` runs INSIDE the message transaction
 * (`Session.updateMessageWithParts`), which is what lets the steering drain stamp
 * its durable row atomically with the message (ADR-146). A behaviour-preserving
 * refactor only — the loop passes the same arguments it used to build inline.
 */
export async function applySteeredMessage(input: {
  sessionID: SessionID
  base: MessageV2.User
  steering: {
    text: string
    messageID: MessageID
    beforeCommit(): void
    afterCommit(): void
  }
}): Promise<void> {
  await createUserMessage(
    {
      sessionID: input.sessionID,
      messageID: input.steering.messageID,
      agentRouting: "preserve",
      agent: input.base.agent,
      model: input.base.model,
      variant: input.base.variant,
      tools: input.base.tools,
      isolation: input.base.isolation,
      system: input.base.system,
      format: input.base.format,
      requestedDepth: input.base.requestedDepth,
      parts: [{ type: "text", text: input.steering.text }],
    },
    input.steering,
  )
}
