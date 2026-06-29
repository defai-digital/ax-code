import type { ScheduledTask } from "@/lib/scheduledTasksApi"

export type ScheduledTaskListLoadResult =
  | { status: "loaded"; tasks: ScheduledTask[] }
  | { status: "stale" }
  | { status: "failed"; error: unknown }

export const loadCurrentScheduledTaskList = async ({
  load,
  isCurrent,
}: {
  load: () => Promise<ScheduledTask[]>
  isCurrent: () => boolean
}): Promise<ScheduledTaskListLoadResult> => {
  try {
    const tasks = await load()
    if (!isCurrent()) {
      return { status: "stale" }
    }
    return { status: "loaded", tasks }
  } catch (error) {
    if (!isCurrent()) {
      return { status: "stale" }
    }
    return { status: "failed", error }
  }
}
