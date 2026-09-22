import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import type { Session, TaskQueueGetResponse } from "@ax-code/sdk/v2"
import { useSDK } from "@tui/context/sdk"
import { useKV } from "@tui/context/kv"
import { useRoute } from "@tui/context/route"
import { useTheme } from "@tui/context/theme"
import { useCommandDialog } from "./dialog-command"
import { SCHEDULED_TASK_EVENTS, type ScheduledTaskInfo } from "./dialog-scheduled-task-view-model"
import { truncateToCellWidth } from "../routes/session/last-input-view-model"
import { scheduleTuiTimeout } from "../util/timer"

const MAX_ROWS = 6
const MAX_CANDIDATES = 12
const MAX_SAVED_KEYS = 200

export type ScheduledSessionLink = {
  taskID: string
  taskTitle: string
  sessionID: string
  lastRunAt: number
  status: TaskQueueGetResponse["status"]
}

export function scheduledSessionKey(link: ScheduledSessionLink): string {
  // A reused session gets a distinct dismissal key for each scheduled run.
  return `${link.sessionID}:${link.lastRunAt}`
}

export function scheduledSessionBuckets(links: readonly ScheduledSessionLink[], cleaned: ReadonlySet<string>) {
  // Tab membership follows the queue lifecycle. Clean only hides terminal runs in this rail.
  const finished = (link: ScheduledSessionLink) =>
    link.status === "completed" || link.status === "failed" || link.status === "cancelled"
  return {
    new: links.filter((link) => !finished(link)),
    finished: links.filter((link) => finished(link) && !cleaned.has(scheduledSessionKey(link))),
  }
}

export function scheduledSessionLinks(
  tasks: readonly ScheduledTaskInfo[],
  queueItems: ReadonlyMap<string, TaskQueueGetResponse>,
  sessions: readonly Session[],
): ScheduledSessionLink[] {
  const knownSessions = new Set(sessions.map((session) => session.id))
  const seen = new Set<string>()
  return tasks
    .filter((task) => task.lastQueueID && task.lastRunAt)
    .toSorted((a, b) => (b.lastRunAt ?? 0) - (a.lastRunAt ?? 0))
    .flatMap((task) => {
      const item = queueItems.get(task.lastQueueID!)
      const sessionID = item?.sessionID
      if (!sessionID || !knownSessions.has(sessionID) || seen.has(sessionID)) return []
      seen.add(sessionID)
      return [{ taskID: task.id, taskTitle: task.title, sessionID, lastRunAt: task.lastRunAt!, status: item.status }]
    })
    .slice(0, MAX_CANDIDATES)
}

export function ScheduledSessionNavigation(props: { width: number; sessions: readonly Session[] }) {
  const sdk = useSDK()
  const kv = useKV()
  const route = useRoute()
  const command = useCommandDialog()
  const { theme } = useTheme()
  const [tasks, setTasks] = createSignal<ScheduledTaskInfo[]>([])
  const [queueItems, setQueueItems] = createSignal<ReadonlyMap<string, TaskQueueGetResponse>>(new Map())
  const [state, setState] = createSignal<"loading" | "ready" | "error">("loading")
  const [tab, setTab] = createSignal<"new" | "finished">("new")
  const contentWidth = () => Math.max(0, props.width - 2)
  const links = createMemo(() => scheduledSessionLinks(tasks(), queueItems(), props.sessions))
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
      const ids = nextTasks
        .filter((task) => task.lastQueueID && task.lastRunAt)
        .toSorted((a, b) => (b.lastRunAt ?? 0) - (a.lastRunAt ?? 0))
        .slice(0, MAX_CANDIDATES)
        .map((task) => task.lastQueueID!)
      const nextItems = new Map<string, TaskQueueGetResponse>()
      await Promise.all(
        ids.map(async (id) => {
          const item = await sdk.client.taskQueue.get({ taskID: id })
          if (item.data) nextItems.set(id, item.data)
        }),
      )
      if (current !== generation) return
      setTasks(nextTasks)
      setQueueItems(nextItems)
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
            <b>{truncateToCellWidth("Scheduled sessions", contentWidth())}</b>
          </text>
        </box>
        <box flexDirection="row" gap={1}>
          <For each={["new", "finished"] as const}>
            {(value) => (
              <box
                paddingRight={1}
                backgroundColor={tab() === value ? theme.backgroundPanel : undefined}
                onMouseUp={() => setTab(value)}
              >
                <text fg={tab() === value ? theme.primary : theme.textMuted} selectable={false}>
                  {value === "new" ? "New" : "Finished"} {buckets()[value].length}
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
              onMouseUp={() => {
                route.navigate({ type: "session", sessionID: link.sessionID })
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
            {tab() === "new" ? "No new sessions" : "No finished sessions"}
          </text>
        </Show>
        <Show when={tab() === "finished" && buckets().finished.length > 0}>
          <box onMouseUp={() => save("scheduled_session_cleaned", buckets().finished.map(scheduledSessionKey))}>
            <text fg={theme.textMuted} selectable={false}>
              Clean finished
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
