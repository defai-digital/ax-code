import { createMemo } from "solid-js"
import type { ScheduleTaskTool } from "@/tool/schedule"
import { InlineTool, type ToolProps } from "./primitives"
import { scheduleTaskLine } from "./schedule-view"

export function ScheduleTask(props: ToolProps<typeof ScheduleTaskTool>) {
  const task = createMemo(() => props.metadata.task)
  const line = createMemo(() =>
    scheduleTaskLine({
      running: props.part.state.status === "running",
      title: task()?.title ?? props.input.title,
      id: task()?.id,
      nextRunAt: task()?.nextRunAt,
    }),
  )
  return (
    <InlineTool icon="◷" pending="Scheduling..." complete={Boolean(task()?.id || props.input.title)} part={props.part}>
      {line()}
    </InlineTool>
  )
}
