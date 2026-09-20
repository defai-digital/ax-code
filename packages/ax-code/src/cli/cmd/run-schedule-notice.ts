import { UI } from "../ui"
import { Log } from "../../util/log"
import { toErrorMessage } from "../../util/error-message"
import { isRunEventStreamFormat } from "./run"

/**
 * Build the pending-schedule exit notice for a headless `ax-code run`. Only
 * tasks with a pending `nextRunAt` count; a task firing right now has none.
 */
export function pendingScheduledTaskNotice(tasks: ReadonlyArray<{ nextRunAt?: number }>): string | undefined {
  const pending = tasks.filter((task) => task.nextRunAt !== undefined).length
  if (pending === 0) return undefined
  return `Note: ${pending} scheduled task(s) for this project fire only while an ax-code backend is running; this process is exiting. Start one with: ax-code runtime start`
}

/**
 * Print the pending-schedule notice after a headless run finishes: scheduled
 * tasks fire only inside a persistent backend, and `ax-code run` is one-shot,
 * so warn before the process exits. Never throws, and never writes for
 * machine-readable event-stream formats.
 */
export async function printPendingScheduledTaskNotice(format: string | undefined): Promise<void> {
  try {
    if (isRunEventStreamFormat(format)) return
    const { ScheduledTask } = await import("@/session/scheduled-task")
    const tasks = await ScheduledTask.list({ status: "active" })
    const notice = pendingScheduledTaskNotice(tasks)
    if (!notice) return
    UI.println(UI.Style.TEXT_DIM + notice + UI.Style.TEXT_NORMAL)
  } catch (error) {
    Log.Default.warn("failed to print pending scheduled task notice", { error: toErrorMessage(error) })
  }
}
