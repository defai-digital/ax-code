import type { MessageV2 } from "../message-v2"

/**
 * ADR-214: small request-only notices the model otherwise lacks.
 *
 * Every decision here is a pure function of the durable message list (plus,
 * for the stale-todo reminder, a precomputed open-todo count), so it survives
 * restarts, cannot drift from what the model can see, and adds nothing to the
 * persisted transcript — the sections are rendered into the per-request turn
 * context (see prompt-turn-context.ts), never stored.
 */

/** Open todos with no todowrite for this many model steps trigger a reminder. */
export const STALE_TODO_STEP_THRESHOLD = 5

function lastAssistantInfo(messages: readonly MessageV2.WithParts[]): MessageV2.Assistant | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const info = messages[i]!.info
    if (info.role === "assistant") return info
  }
  return undefined
}

/**
 * Interruption marker: the previous assistant turn ended in a user abort
 * (MessageAbortedError), so its output may be incomplete. One fixed line on
 * the first request after the abort; once the next assistant message exists
 * the marker disappears. A reverted turn's messages are removed from the
 * list, so a reverted abort never fires the marker.
 */
export function interruptionNotice(messages: readonly MessageV2.WithParts[]): string | undefined {
  const last = lastAssistantInfo(messages)
  if (!last) return undefined
  if (last.error?.name !== "MessageAbortedError") return undefined
  return [
    "<turn_interrupted>",
    "The previous turn was interrupted before it completed; the output above may be partial or cut off mid-task.",
    "Re-check the last actions and results before continuing.",
    "</turn_interrupted>",
  ].join("\n")
}

/**
 * Model steps since the last completed todowrite: the number of assistant
 * messages after the message that carries the most recent completed
 * todowrite tool part. A completed todowrite on the newest assistant message
 * counts as zero elapsed steps; a rejected, failed or cancelled call does
 * not reset the counter (it never put a list into the history). With no
 * todowrite in the visible history every assistant step counts.
 */
export function stepsSinceTodoWrite(messages: readonly MessageV2.WithParts[]): number {
  let steps = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (
      message.parts.some(
        (part) => part.type === "tool" && part.tool === "todowrite" && part.state.status === "completed",
      )
    ) {
      break
    }
    if (message.info.role === "assistant") steps++
  }
  return steps
}

/**
 * Stale-todo reminder: open todos and no todowrite for
 * STALE_TODO_STEP_THRESHOLD model steps, re-fired at most every
 * STALE_TODO_STEP_THRESHOLD further steps (a todowrite resets the count and
 * therefore the cadence).
 */
export function staleTodoNotice(input: { openTodos: number; stepsSinceTodoWrite: number }): string | undefined {
  if (input.openTodos <= 0) return undefined
  const steps = input.stepsSinceTodoWrite
  if (steps < STALE_TODO_STEP_THRESHOLD) return undefined
  if (steps % STALE_TODO_STEP_THRESHOLD !== 0) return undefined
  return [
    `<stale_todos steps="${steps}">`,
    `${input.openTodos} open todo${input.openTodos === 1 ? "" : "s"} without a todo-list update for ${steps} model steps.`,
    "If progress has happened, update the todo statuses with todowrite; if priorities changed, rewrite the list.",
    "</stale_todos>",
  ].join("\n")
}

/**
 * Model-switch notice: the model anchored for this request (the last user
 * message's model) differs from the model of the last assistant message.
 * Fires once per switch — as soon as an assistant message on the new model
 * lands, the two agree again and the notice stops.
 */
export function modelSwitchNotice(messages: readonly MessageV2.WithParts[]): string | undefined {
  const lastUser = messages.findLast((message) => message.info.role === "user")
  const lastAssistant = lastAssistantInfo(messages)
  if (lastUser?.info.role !== "user" || !lastAssistant) return undefined
  const current = lastUser.info.model
  // A user message without an anchored model (defensive: older or foreign
  // records) says nothing about a switch.
  if (!current) return undefined
  const previous = { providerID: lastAssistant.providerID, modelID: lastAssistant.modelID }
  if (current.providerID === previous.providerID && current.modelID === previous.modelID) return undefined
  const currentKey = `${current.providerID}/${current.modelID}`
  const previousKey = `${previous.providerID}/${previous.modelID}`
  return [
    `<model_switch previous="${previousKey}" current="${currentKey}">`,
    `The model changed mid-session: earlier turns were produced by ${previousKey}; this request runs on ${currentKey}.`,
    "Treat the earlier output as ordinary context and continue the task with the current model.",
    "</model_switch>",
  ].join("\n")
}
