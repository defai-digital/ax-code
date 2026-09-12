import { createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { TextAttributes } from "ax-tui"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { useSDK } from "@tui/context/sdk"
import { useToast } from "../ui/toast"
import { useTheme } from "../context/theme"
import { Keybind } from "@/util/keybind"
import { Log } from "@/util/log"
import type { ScheduledTaskInfo, ScheduledTaskRunInfo } from "./dialog-scheduled-task-view-model"
import {
  runDescription,
  runTitle,
  sortTasks,
  taskDescription,
  taskStatusLabel,
} from "./dialog-scheduled-task-view-model"

const log = Log.create({ service: "tui.dialog-scheduled-task" })

const SCHEDULED_TASK_EVENTS = [
  "scheduled.task.created",
  "scheduled.task.updated",
  "scheduled.task.deleted",
  "scheduled.task.fired",
  "scheduled.task.succeeded",
  "scheduled.task.failed",
  "scheduled.task.skipped",
  "scheduled.task.failed_persistently",
] as const

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (error && typeof error === "object") {
    const candidate = error as { data?: { message?: string }; message?: string }
    return candidate.data?.message ?? candidate.message ?? fallback
  }
  return fallback
}

function StatusBadge(props: { task: ScheduledTaskInfo }) {
  const { theme } = useTheme()
  const fg = () =>
    props.task.status === "active" ? theme.success : props.task.status === "paused" ? theme.warning : theme.textMuted
  return (
    <span style={{ fg: fg(), attributes: props.task.status === "active" ? TextAttributes.BOLD : undefined }}>
      {taskStatusLabel(props.task)}
    </span>
  )
}

export function DialogScheduledTask() {
  const dialog = useDialog()
  const sdk = useSDK()
  const toast = useToast()
  const { theme } = useTheme()

  const [tasks, setTasks] = createSignal<ScheduledTaskInfo[]>([])
  const [toDelete, setToDelete] = createSignal<string>()
  const [busy, setBusy] = createSignal<string | null>(null)

  async function refresh() {
    try {
      const result = await sdk.client.scheduledTask.list()
      if (result.error) {
        log.warn("scheduled task list load failed", { error: result.error })
        toast.show({ message: errorMessage(result.error, "Failed to load scheduled tasks"), variant: "error" })
        return
      }
      setTasks(result.data ?? [])
    } catch (error) {
      log.warn("scheduled task list load failed", { error })
      toast.show({ message: errorMessage(error, "Failed to load scheduled tasks"), variant: "error" })
    }
  }

  onMount(() => {
    dialog.setSize("large")
    void refresh()
    const unsubscribers = SCHEDULED_TASK_EVENTS.map((type) => sdk.event.on(type, () => void refresh()))
    onCleanup(() => {
      for (const unsubscribe of unsubscribers) unsubscribe()
    })
  })

  const options = createMemo(() =>
    sortTasks(tasks()).map((task) => ({
      title: toDelete() === task.id ? `Press ctrl+d again to delete "${task.title}"` : task.title,
      value: task.id,
      description: taskDescription(task),
      footer: <StatusBadge task={task} />,
      bg: toDelete() === task.id ? theme.error : undefined,
    })),
  )

  function taskByID(id: string): ScheduledTaskInfo | undefined {
    return tasks().find((task) => task.id === id)
  }

  async function run(action: string, id: string, fn: () => Promise<{ error?: unknown }>) {
    if (busy() !== null) return
    setBusy(id)
    try {
      const result = await fn()
      if (result.error) {
        toast.show({ message: errorMessage(result.error, `Failed to ${action} scheduled task`), variant: "error" })
        return
      }
      await refresh()
    } catch (error) {
      log.warn(`scheduled task ${action} failed`, { error, id })
      toast.show({ message: errorMessage(error, `Failed to ${action} scheduled task`), variant: "error" })
    } finally {
      setBusy(null)
    }
  }

  return (
    <DialogSelect
      title="Scheduled Tasks"
      options={options()}
      onMove={() => setToDelete(undefined)}
      onSelect={(option) => {
        const task = taskByID(option.value)
        if (!task) return
        dialog.replace(() => <DialogScheduledTaskRuns task={task} />)
      }}
      keybind={[
        {
          keybind: Keybind.parse("space")[0],
          title: "pause/resume",
          onTrigger: (option) => {
            const task = taskByID(option.value)
            if (!task) return
            const action = task.status === "active" ? "pause" : "resume"
            void run(action, task.id, async () => {
              const result =
                action === "pause"
                  ? await sdk.client.scheduledTask.pause({ scheduledTaskID: task.id })
                  : await sdk.client.scheduledTask.resume({ scheduledTaskID: task.id })
              if (!result.error) {
                toast.show({ message: `${action === "pause" ? "Paused" : "Resumed"}: ${task.title}`, variant: "info" })
              }
              return result
            })
          },
        },
        {
          keybind: Keybind.parse("ctrl+r")[0],
          title: "run now",
          onTrigger: (option) => {
            const task = taskByID(option.value)
            if (!task) return
            void run("run", task.id, async () => {
              const result = await sdk.client.scheduledTask.runNow({ scheduledTaskID: task.id })
              if (!result.error) toast.show({ message: `Running now: ${task.title}`, variant: "success" })
              return result
            })
          },
        },
        {
          keybind: Keybind.parse("ctrl+d")[0],
          title: "delete",
          onTrigger: (option) => {
            const task = taskByID(option.value)
            if (!task) return
            if (toDelete() !== task.id) {
              setToDelete(task.id)
              return
            }
            setToDelete(undefined)
            void run("delete", task.id, () => sdk.client.scheduledTask.delete({ scheduledTaskID: task.id }))
          },
        },
      ]}
    />
  )
}

function DialogScheduledTaskRuns(props: { task: ScheduledTaskInfo }) {
  const dialog = useDialog()
  const route = useRoute()
  const sync = useSync()
  const sdk = useSDK()
  const toast = useToast()

  const [runs, setRuns] = createSignal<ScheduledTaskRunInfo[]>([])

  onMount(() => {
    sdk.client.scheduledTask
      .listRuns({ scheduledTaskID: props.task.id })
      .then((result) => {
        if (result.error) {
          log.warn("scheduled task runs load failed", { error: result.error, id: props.task.id })
          toast.show({ message: errorMessage(result.error, "Failed to load runs"), variant: "error" })
          return
        }
        setRuns(result.data ?? [])
      })
      .catch((error) => {
        log.warn("scheduled task runs load failed", { error, id: props.task.id })
        toast.show({ message: errorMessage(error, "Failed to load runs"), variant: "error" })
      })
  })

  function automationSessionID(run: ScheduledTaskRunInfo): string | undefined {
    if (!run.queueID) return undefined
    return sync.data.task_queue.find((item) => item.id === run.queueID)?.sessionID
  }

  const options = createMemo(() =>
    runs().map((run) => ({
      title: runTitle(run),
      value: run.id,
      description: runDescription(run),
      footer: automationSessionID(run) ? "enter: open session" : undefined,
    })),
  )

  return (
    <DialogSelect
      title={`Runs: ${props.task.title}`}
      options={options()}
      onSelect={(option) => {
        const run = runs().find((item) => item.id === option.value)
        if (!run) return
        const sessionID = automationSessionID(run)
        if (!sessionID) {
          toast.show({ message: "No recorded automation session for this run", variant: "info" })
          return
        }
        dialog.clear()
        route.navigate({ type: "session", sessionID })
      }}
    />
  )
}
