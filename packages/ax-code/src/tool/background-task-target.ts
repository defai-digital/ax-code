import { Session } from "../session"
import { childVisibleText } from "../session/background-subagent-handoff"
import { SessionID, TaskQueueID } from "../session/schema"
import { TaskQueue } from "../session/task-queue"
import { NotFoundError } from "../storage/db"

export async function resolveBackgroundTask(taskID: string, source?: "task"): Promise<TaskQueue.Info | undefined> {
  try {
    if (taskID.startsWith("tsk_")) return await TaskQueue.get(TaskQueueID.make(taskID))
    if (taskID.startsWith("ses_")) {
      const [item] = await TaskQueue.list({
        sessionID: SessionID.make(taskID),
        kind: "subagent",
        source,
        newestCreatedFirst: true,
        // The bounded page can skip malformed historical queue rows.
        limit: 100,
      })
      return item
    }
    return undefined
  } catch (error) {
    if (NotFoundError.isInstance(error)) return undefined
    throw error
  }
}

export async function childResultText(item: TaskQueue.Info): Promise<string> {
  if (!item.sessionID) return ""
  const messages = await Session.messages({ sessionID: item.sessionID }).catch((e) => {
    if (NotFoundError.isInstance(e)) return [] as Awaited<ReturnType<typeof Session.messages>>
    throw e
  })
  const lastAssistant = messages.findLast((message) => message.info.role === "assistant")
  return childVisibleText(lastAssistant)
}
