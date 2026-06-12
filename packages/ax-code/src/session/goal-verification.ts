import { isActiveTodo } from "./todo-status"
import { asRecordOrUndefined } from "../util/record"

/**
 * Evidence gate for `update_goal { status: "complete" }`.
 *
 * The goal continuation prompt tells the model not to declare a goal
 * complete until the objective is actually achieved, but that was
 * prompt-only — a model could end a goal run early by simply calling
 * update_goal. This gate adds the same kind of runtime enforcement the
 * todo completion gate provides:
 *
 *   1. A goal cannot complete while todos are still pending.
 *   2. If the session modified files, at least one command (bash) must
 *      have completed AFTER the last file mutation — i.e. the model has
 *      to run its tests/build before claiming success. Goals that never
 *      modified files (research/review goals) are not affected.
 *
 * Both rejections are recoverable: the model finishes the todos or runs
 * a verification command, then calls update_goal again.
 */
export namespace GoalVerification {
  export type Todo = { status?: unknown }

  export type Message = {
    info?: { role?: string }
    parts?: readonly unknown[]
  }

  export type Decision =
    | { ok: true }
    | { ok: false; reason: "pending_todos"; message: string }
    | { ok: false; reason: "unverified_changes"; message: string }

  const MUTATION_TOOLS = new Set(["edit", "write", "apply_patch", "multiedit", "patch"])
  const VERIFICATION_TOOLS = new Set(["bash"])

  export function decide(input: { messages: readonly Message[]; pendingTodos: readonly Todo[] }): Decision {
    const pending = input.pendingTodos.filter(isActiveTodo)
    if (pending.length > 0) {
      return {
        ok: false,
        reason: "pending_todos",
        message:
          `Cannot mark the goal complete: ${pending.length} todo(s) are still pending or in progress. ` +
          `Finish or cancel them first, then mark the goal complete.`,
      }
    }

    let sawMutation = false
    let verifiedAfterMutation = true
    for (const message of input.messages) {
      if (message.info?.role !== "assistant") continue
      for (const part of message.parts ?? []) {
        const record = asRecordOrUndefined(part)
        if (!record || record["type"] !== "tool") continue
        const tool = record["tool"]
        if (typeof tool !== "string") continue
        const state = asRecordOrUndefined(record["state"])
        if (state?.["status"] !== "completed") continue
        if (MUTATION_TOOLS.has(tool)) {
          sawMutation = true
          verifiedAfterMutation = false
        } else if (VERIFICATION_TOOLS.has(tool)) {
          verifiedAfterMutation = true
        }
      }
    }
    if (sawMutation && !verifiedAfterMutation) {
      return {
        ok: false,
        reason: "unverified_changes",
        message:
          `Cannot mark the goal complete: files were modified after the last command run. ` +
          `Run your tests, build, or another verification command to confirm the changes work, ` +
          `then mark the goal complete.`,
      }
    }

    return { ok: true }
  }
}
