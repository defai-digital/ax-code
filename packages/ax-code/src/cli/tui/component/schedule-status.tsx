import { useLanguage } from "@tui/context/language"
import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js"
import { useSDK } from "@tui/context/sdk"
import { useTheme } from "@tui/context/theme"
import { useCommandDialog } from "./dialog-command"
import { truncateToCellWidth } from "../routes/session/last-input-view-model"
import type { ScheduledTaskInfo } from "./dialog-scheduled-task-view-model"
import { SCHEDULED_TASK_EVENTS, scheduleStatus, type ScheduleLoadState } from "./dialog-scheduled-task-view-model"

export function ScheduleStatus(props: { width: number; compact?: boolean; showWhenEmpty?: boolean }) {
  const uiText = useLanguage().t

  const sdk = useSDK()
  const command = useCommandDialog()
  const { theme } = useTheme()
  const [tasks, setTasks] = createSignal<ScheduledTaskInfo[]>([])
  const [loadState, setLoadState] = createSignal<ScheduleLoadState>("loading")

  async function refresh() {
    try {
      const result = await sdk.client.scheduledTask.list()
      if (result.error) {
        setLoadState("error")
        return
      }
      setTasks(result.data ?? [])
      setLoadState("ready")
    } catch {
      // Navigation chrome must not toast on a background poll.
      setLoadState("error")
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

  let wasConnected = sdk.sseConnected
  createEffect(() => {
    const connected = sdk.sseConnected
    if (connected && !wasConnected) void refresh()
    wasConnected = connected
  })

  const status = createMemo(() =>
    scheduleStatus({ tasks: tasks(), loadState: loadState(), connected: sdk.sseConnected }),
  )

  const fg = () => {
    switch (status().tone) {
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

  const label = () => uiText("ui.schedule")

  const compactText = () => {
    const view = status()
    if (view.kind === "summary") return view.disconnected ? `${view.compact}*` : view.compact
    if (view.status === "empty") return uiText("ui.noScheduledTasks")
    if (view.status === "inactive") return label()
    if (view.status === "loading") return `${label()} ...`
    return `${label()} ${view.status === "offline" ? "*" : "!"}`
  }

  const detailText = () => {
    const view = status()
    if (view.kind === "summary") return view.detail
    return (
      {
        loading: uiText("ui.loading"),
        error: `${label()} !`,
        offline: uiText("ui.cachedDisconnected"),
        empty: uiText("ui.noScheduledTasks"),
        inactive: uiText("ui.scheduledTasks"),
      } as const
    )[view.status]
  }

  return (
    <Show when={props.showWhenEmpty || status().kind === "summary"}>
      <box flexShrink={0} onMouseUp={() => command.trigger("scheduled.list")}>
        <Show
          when={props.compact}
          fallback={
            <>
              <text fg={theme.text} selectable={false}>
                <b>{label()}</b>
              </text>
              <text fg={fg()} selectable={false}>
                {truncateToCellWidth(detailText(), props.width)}
              </text>
            </>
          }
        >
          <text fg={fg()} selectable={false}>
            {truncateToCellWidth(compactText(), Math.max(8, props.width))}
          </text>
        </Show>
      </box>
    </Show>
  )
}
