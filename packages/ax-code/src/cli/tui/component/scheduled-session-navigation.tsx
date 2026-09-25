import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { MouseButton, type MouseEvent } from "ax-tui"
import type { Session, TaskQueueGetResponse } from "@ax-code/sdk/v2"
import { Locale } from "@/util/locale"
import { useSDK } from "@tui/context/sdk"
import { useKV } from "@tui/context/kv"
import { useRoute } from "@tui/context/route"
import { useTheme } from "@tui/context/theme"
import { useLanguage } from "@tui/context/language"
import { useToast } from "@tui/ui/toast"
import { useContextMenu } from "@tui/ui/context-menu"
import { useCommandDialog } from "./dialog-command"
import {
  SCHEDULED_TASK_EVENTS,
  type ScheduledTaskInfo,
  type ScheduledTaskRunInfo,
} from "./dialog-scheduled-task-view-model"
import { truncateToCellWidth } from "../routes/session/last-input-view-model"
import { scheduleTuiTimeout } from "../util/timer"

const MAX_ROWS = 6
const MAX_SAVED_KEYS = 200

export type ScheduledSessionLink = {
  taskID: string
  taskTitle: string
  sessionID?: string
  lastRunAt: number
  status: TaskQueueGetResponse["status"] | ScheduledTaskRunInfo["status"] | "scheduled" | "unknown"
  phase: "new" | "running" | "done"
  detail: string
  scheduleDetail?: string
}

export function scheduledSessionKey(link: ScheduledSessionLink): string {
  return `${link.taskID}:${link.lastRunAt}`
}

export function scheduledSessionBuckets(links: readonly ScheduledSessionLink[], cleaned: ReadonlySet<string>) {
  return {
    new: links.filter((link) => link.phase === "new"),
    running: links.filter((link) => link.phase === "running"),
    done: links.filter(
      (link) =>
        link.phase === "done" &&
        !cleaned.has(scheduledSessionKey(link)) &&
        !cleaned.has(`${link.sessionID}:${link.lastRunAt}`),
    ),
  }
}

// Skipped ticks are history, not replacements for the latest actual execution.
export function scheduledNavigationRun(runs: readonly ScheduledTaskRunInfo[]): ScheduledTaskRunInfo | undefined {
  const ordered = runs.toSorted((a, b) => b.time.created - a.time.created)
  return ordered.find((run) => run.status !== "skipped_overlap" && run.status !== "missed_skip") ?? ordered[0]
}

export function scheduledSessionLinks(
  tasks: readonly ScheduledTaskInfo[],
  queueItems: ReadonlyMap<string, TaskQueueGetResponse>,
  sessions: readonly Session[],
  runs: ReadonlyMap<string, ScheduledTaskRunInfo> = new Map(),
): ScheduledSessionLink[] {
  const knownSessions = new Set(sessions.map((session) => session.id))
  return tasks
    .toSorted((a, b) => (b.lastRunAt ?? 0) - (a.lastRunAt ?? 0))
    .flatMap((task) => {
      const item = task.lastQueueID ? queueItems.get(task.lastQueueID) : undefined
      const run = runs.get(task.id)
      const status = item?.status ?? run?.status
      const terminal =
        status && ["completed", "failed", "cancelled", "timeout", "skipped_overlap", "missed_skip"].includes(status)
      const started =
        task.lastRunAt !== undefined ||
        (status !== undefined && status !== "missed_skip" && status !== "skipped_overlap")
      const executing = status !== undefined && !terminal
      // A completed occurrence does not finish the schedule's lifetime.
      // Missing execution data cannot prove that a disabled schedule has drained.
      const phase =
        executing || (!status && started)
          ? "running"
          : task.status === "disabled"
            ? "done"
            : started
              ? "running"
              : "new"
      const detail =
        !status && started
          ? "Status unavailable"
          : task.status === "paused" && !executing
            ? "Schedule paused"
            : terminal && phase === "running"
              ? status === "completed"
                ? "Waiting for next run"
                : `Last run: ${status.replaceAll("_", " ")}`
              : (status?.replaceAll("_", " ") ?? (phase === "done" ? "Schedule ended" : "Scheduled"))
      return [
        {
          taskID: task.id,
          taskTitle:
            phase === "running" && ["daily", "weekly", "cron"].includes(task.schedule?.type)
              ? `R ${task.title}`
              : task.title,
          lastRunAt: task.lastRunAt ?? 0,
          sessionID: item?.sessionID && knownSessions.has(item.sessionID) ? item.sessionID : undefined,
          status: status ?? (started ? "unknown" : "scheduled"),
          phase,
          detail,
          scheduleDetail:
            phase === "done"
              ? undefined
              : task.status === "paused"
                ? "Schedule paused"
                : task.status === "active" && task.nextRunAt !== undefined
                  ? `Next ${Locale.todayTimeOrDateTime(task.nextRunAt)}`
                  : undefined,
        } satisfies ScheduledSessionLink,
      ]
    })
}

export function ScheduledSessionNavigation(props: { width: number; sessions: readonly Session[] }) {
  const uiText = useLanguage().t
  const sdk = useSDK()
  const kv = useKV()
  const route = useRoute()
  const command = useCommandDialog()
  const toast = useToast()
  const contextMenu = useContextMenu()
  const { theme } = useTheme()
  const [tasks, setTasks] = createSignal<ScheduledTaskInfo[]>([])
  const [runs, setRuns] = createSignal<ReadonlyMap<string, ScheduledTaskRunInfo>>(new Map())
  const [queueItems, setQueueItems] = createSignal<ReadonlyMap<string, TaskQueueGetResponse>>(new Map())
  const [state, setState] = createSignal<"loading" | "ready" | "error">("loading")
  const [tab, setTab] = createSignal<"new" | "running" | "done">("new")
  const contentWidth = () => Math.max(0, props.width - 2)
  const links = createMemo(() => scheduledSessionLinks(tasks(), queueItems(), props.sessions, runs()))
  const savedKey = (name: string) => `${name}:${sdk.directory ?? ""}`
  const saved = (name: string) => {
    const value: unknown = kv.get(savedKey(name), [])
    return new Set<string>(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [])
  }
  const buckets = createMemo(() => scheduledSessionBuckets(links(), saved("scheduled_session_cleaned")))
  const visible = () => buckets()[tab()].slice(0, MAX_ROWS)
  function save(name: string, keys: readonly string[]) {
    kv.set(savedKey(name), [...new Set([...saved(name), ...keys])].slice(-MAX_SAVED_KEYS))
  }
  let generation = 0
  let stopRefresh = () => {}

  async function refresh() {
    const current = ++generation
    try {
      const result = await sdk.client.scheduledTask.list()
      if (result.error) throw result.error
      const nextTasks = result.data ?? []
      const nextItems = new Map<string, TaskQueueGetResponse>()
      const nextRuns = new Map<string, ScheduledTaskRunInfo>()
      // Bound concurrent requests without dropping older active tasks from the rail.
      for (let offset = 0; offset < nextTasks.length; offset += 6) {
        await Promise.all(
          nextTasks.slice(offset, offset + 6).map(async (task) => {
            if (task.lastQueueID) {
              const item = await sdk.client.taskQueue.get({ taskID: task.lastQueueID })
              if (item.data) nextItems.set(task.lastQueueID, item.data)
            }
            if (task.lastRunAt !== undefined && !nextItems.has(task.lastQueueID ?? "")) {
              const history = await sdk.client.scheduledTask.listRuns({ scheduledTaskID: task.id })
              const latest = scheduledNavigationRun(history.data ?? [])
              if (latest) nextRuns.set(task.id, latest)
            }
          }),
        )
        if (current !== generation) return
      }
      if (current !== generation) return
      setTasks(nextTasks)
      setQueueItems(nextItems)
      setRuns(nextRuns)
      setState("ready")
    } catch {
      if (current === generation) setState("error")
    }
  }

  function requestRefresh() {
    stopRefresh()
    stopRefresh = scheduleTuiTimeout(() => void refresh(), {
      name: "scheduled-session-navigation-refresh",
      delayMs: 150,
      unref: true,
    })
  }

  async function deleteTask(taskID: string) {
    try {
      const result = await sdk.client.scheduledTask.delete({ scheduledTaskID: taskID })
      if (result.error) {
        toast.show({ message: uiText("ui.failedToDeleteScheduledTask"), variant: "error" })
        return
      }
      requestRefresh()
    } catch {
      toast.show({ message: uiText("ui.failedToDeleteScheduledTask"), variant: "error" })
    }
  }

  // A task can vanish from the rail while its context menu is open (SSE
  // refresh after a delete elsewhere). Clicking through would run a stale
  // handler, so close the menu instead.
  createEffect(() => {
    const menu = contextMenu.current
    if (menu?.kind !== "scheduled-task") return
    if (links().some((link) => link.taskID === menu.taskID)) return
    contextMenu.close()
  })

  // The rail is the only opener of scheduled-task menus; a menu must not
  // outlive the rail itself (e.g. the navigation rail unmounts on layout
  // changes). Tasks draining to zero close the menu via the links effect.
  onCleanup(() => {
    if (contextMenu.current?.kind === "scheduled-task") contextMenu.close()
  })

  onMount(() => {
    void refresh()
    const event = sdk.event
    const unsubscribers = event?.on
      ? [
          ...SCHEDULED_TASK_EVENTS.map((type) => event.on(type, requestRefresh)),
          event.on("task.queue.updated", (event) => {
            const item = event.properties.item
            if (item.kind === "automation" && item.sourceTaskID?.startsWith("sch_")) requestRefresh()
          }),
          event.on("task.queue.deleted", requestRefresh),
        ]
      : []
    onCleanup(() => {
      generation++
      stopRefresh()
      for (const unsubscribe of unsubscribers) unsubscribe()
    })
  })

  let wasConnected = sdk.sseConnected
  createEffect(() => {
    const connected = sdk.sseConnected
    if (connected && !wasConnected) requestRefresh()
    wasConnected = connected
  })
  let previousDirectory = sdk.directory
  createEffect(() => {
    const directory = sdk.directory
    if (directory !== previousDirectory) requestRefresh()
    previousDirectory = directory
  })
  return (
    <Show when={tasks().length > 0 || state() !== "ready"}>
      <box
        width={props.width}
        flexShrink={0}
        paddingLeft={1}
        paddingRight={1}
        marginBottom={1}
        backgroundColor={theme.backgroundElement}
      >
        <box onMouseUp={() => command.trigger("scheduled.list")}>
          <text fg={theme.textMuted} selectable={false}>
            <b>{truncateToCellWidth("Scheduled tasks", contentWidth())}</b>
          </text>
        </box>
        <box flexDirection="row" flexWrap="wrap" gap={1}>
          <For each={["new", "running", "done"] as const}>
            {(value) => (
              <box
                paddingRight={1}
                backgroundColor={tab() === value ? theme.backgroundPanel : undefined}
                onMouseUp={() => setTab(value)}
              >
                <text fg={tab() === value ? theme.primary : theme.textMuted} selectable={false}>
                  {value === "new" ? "New" : value === "running" ? "Running" : "Done"} {buckets()[value].length}
                </text>
              </box>
            )}
          </For>
        </box>
        <For each={visible()}>
          {(link) => (
            <box
              backgroundColor={
                route.data.type === "session" && route.data.sessionID === link.sessionID
                  ? theme.backgroundPanel
                  : undefined
              }
              onMouseDown={(evt: MouseEvent) => {
                // Only the right button opens the task menu; every other
                // button must keep bubbling so a press elsewhere still closes
                // an open menu through the app-root handler.
                if (evt.button !== MouseButton.RIGHT) return
                evt.stopPropagation()
                evt.preventDefault()
                contextMenu.openAt({
                  kind: "scheduled-task",
                  x: evt.x,
                  y: evt.y,
                  taskID: link.taskID,
                  onDelete: () => void deleteTask(link.taskID),
                })
              }}
              onMouseUp={(evt: MouseEvent) => {
                // The terminating release of a right-click must not navigate.
                if (evt.button !== MouseButton.LEFT) return
                if (link.sessionID) route.navigate({ type: "session", sessionID: link.sessionID })
                else command.trigger("scheduled.list")
              }}
            >
              <text
                fg={
                  route.data.type === "session" && route.data.sessionID === link.sessionID ? theme.primary : theme.text
                }
                selectable={false}
              >
                {truncateToCellWidth(link.taskTitle, contentWidth())}
              </text>
              <text fg={theme.textMuted} selectable={false}>
                {truncateToCellWidth(link.detail, contentWidth())}
              </text>
              <Show when={link.scheduleDetail}>
                <text fg={theme.textMuted} selectable={false}>
                  {truncateToCellWidth(link.scheduleDetail!, contentWidth())}
                </text>
              </Show>
            </box>
          )}
        </For>
        <Show when={buckets()[tab()].length > MAX_ROWS}>
          <box onMouseUp={() => command.trigger("scheduled.list")}>
            <text fg={theme.textMuted} selectable={false}>
              {truncateToCellWidth(`${buckets()[tab()].length - MAX_ROWS} more in Schedule`, contentWidth())}
            </text>
          </box>
        </Show>
        <Show when={state() === "ready" && visible().length === 0}>
          <text fg={theme.textMuted} selectable={false}>
            {tab() === "new" ? "No new tasks" : tab() === "running" ? "No running tasks" : "No done tasks"}
          </text>
        </Show>
        <Show when={tab() === "done" && buckets().done.length > 0}>
          <box onMouseUp={() => save("scheduled_session_cleaned", buckets().done.map(scheduledSessionKey))}>
            <text fg={theme.textMuted} selectable={false}>
              Clear done
            </text>
          </box>
        </Show>
        <Show when={state() === "loading" && links().length === 0}>
          <text fg={theme.textMuted} selectable={false}>
            Loading...
          </text>
        </Show>
        <Show when={state() === "error"}>
          <text fg={theme.warning} selectable={false}>
            Schedule unavailable
          </text>
        </Show>
      </box>
    </Show>
  )
}
