import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js"
import { useSDK } from "@tui/context/sdk"
import { useTheme } from "@tui/context/theme"
import { useCommandDialog } from "./dialog-command"
import { truncateToCellWidth } from "../routes/session/last-input-view-model"
import type { ScheduledTaskInfo } from "./dialog-scheduled-task-view-model"
import { SCHEDULED_TASK_EVENTS, scheduleChrome } from "./dialog-scheduled-task-view-model"

export function ScheduleStatus(props: { width: number; compact?: boolean }) {
  const sdk = useSDK()
  const command = useCommandDialog()
  const { theme } = useTheme()
  const [tasks, setTasks] = createSignal<ScheduledTaskInfo[]>([])

  async function refresh() {
    try {
      const result = await sdk.client.scheduledTask.list()
      if (result.error) return
      setTasks(result.data ?? [])
    } catch {
      // Navigation chrome must not toast on a background poll.
    }
  }

  onMount(() => {
    void refresh()
    const event = sdk.event
    if (!event?.on) return
    const unsubscribers = SCHEDULED_TASK_EVENTS.map((type) => event.on(type, () => void refresh()))
    onCleanup(() => {
      for (const unsubscribe of unsubscribers) unsubscribe()
    })
  })

  const chrome = createMemo(() => scheduleChrome(tasks()))
  const fg = () => {
    switch (chrome()?.tone) {
      case "error":
        return theme.error
      case "warning":
        return theme.warning
      case "success":
        return theme.success
      default:
        return theme.textMuted
    }
  }

  return (
    <Show when={chrome()}>
      {(view) => (
        <box flexShrink={0} onMouseUp={() => command.trigger("scheduled.list")}>
          <Show
            when={props.compact}
            fallback={
              <>
                <text fg={theme.text} selectable={false}>
                  <b>Schedule</b>
                </text>
                <text fg={fg()} selectable={false}>
                  {truncateToCellWidth(view().detail, props.width)}
                </text>
              </>
            }
          >
            <text fg={fg()} selectable={false}>
              {truncateToCellWidth(view().compact, Math.max(8, props.width))}
            </text>
          </Show>
        </box>
      )}
    </Show>
  )
}
