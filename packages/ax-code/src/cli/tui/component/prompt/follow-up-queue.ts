/** Shared composer input types; accepted follow-ups live in the server task queue. */

/** A prompt part as captured from the composer; shape mirrors the prompt body parts. */
export type FollowUpPart = { id?: string; type: string; text?: string; [key: string]: unknown }

export interface FollowUpInput {
  parts: FollowUpPart[]
  agent?: string
  model?: { providerID: string; modelID: string }
  variant?: string
}

/** A busy or retrying session accepts subsequent prompts as durable follow-ups. */
export function isQueueableStatus(type: string | undefined): boolean {
  return type === "busy" || type === "retry"
}

/** Preserve composer text exactly when opening a paused follow-up for editing. */
export function followUpText(item: FollowUpInput): string {
  return item.parts.find((part) => part.type === "text" && typeof part.text === "string")?.text ?? ""
}
