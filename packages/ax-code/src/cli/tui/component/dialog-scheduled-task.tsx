import { useLanguage } from "@tui/context/language"
import { createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { TextAttributes } from "ax-tui"
import { useDialog } from "@tui/ui/dialog"
import { DialogConfirm } from "@tui/ui/dialog-confirm"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { useSDK } from "@tui/context/sdk"
import { useToast } from "../ui/toast"
import { useTheme } from "../context/theme"
import { Keybind } from "@/util/keybind"
import { Log } from "@/util/log"
import { requestErrorMessage } from "../util/error-message"
import type { ScheduledTaskInfo, ScheduledTaskRunInfo } from "./dialog-scheduled-task-view-model"
import {
  SCHEDULED_TASK_EVENTS,
  cleanupConfirmMessage,
  cleanupOptions,
  cleanupResultMessage,
  cleanupTargets,
  deleteTaskMessage,
  runDescription,
  runTitle,
  sortTasks,
  taskDescription,
  taskStatusLabel,
  type CleanupKind,
} from "./dialog-scheduled-task-view-model"

const log = Log.create({ service: "tui.dialog-scheduled-task" })

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
  const uiText = useLanguage().t

  const dialog = useDialog()
  const sdk = useSDK()
  const toast = useToast()

  const [tasks, setTasks] = createSignal<ScheduledTaskInfo[]>([])
  const [busy, setBusy] = createSignal<string | null>(null)

  // Out-of-order refresh races: several scheduled.task events can arrive in a
  // burst and the slower response must not overwrite newer data.
  let refreshGeneration = 0

  // The delete/cleanup flow replaces this dialog with a modal confirm; every
  // exit path returns to a fresh task list afterwards.
  function reopenList() {
    dialog.replace(() => <DialogScheduledTask />)
  }

  // The cleanup picker must not reopen the list when the confirm modal takes
  // over — only when the picker itself is dismissed.
  let suppressCleanupCloseReopen = false

  async function refresh() {
    const current = ++refreshGeneration
    try {
      const result = await sdk.client.scheduledTask.list()
      if (current !== refreshGeneration) return
      if (result.error) {
        log.warn("scheduled task list load failed", { error: result.error })
        toast.show({ message: requestErrorMessage(result.error, "Failed to load scheduled tasks"), variant: "error" })
        return
      }
      setTasks(result.data ?? [])
    } catch (error) {
      if (current !== refreshGeneration) return
      log.warn("scheduled task list load failed", { error })
      toast.show({ message: requestErrorMessage(error, "Failed to load scheduled tasks"), variant: "error" })
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

  const options = createMemo(() => {
    const rows = sortTasks(tasks()).map((task) => ({
      title: task.title,
      value: task.id,
      description: taskDescription(task),
      footer: <StatusBadge task={task} />,
    }))
    if (rows.length > 0) return rows
    return [
      {
        title: uiText("ui.noScheduledTasks"),
        value: "empty",
        description: uiText("ui.askTheAgentToScheduleWorkItOnlyRunsWhileThisProjectBackendIsAlive"),
        disabled: true,
      },
    ]
  })

  function taskByID(id: string): ScheduledTaskInfo | undefined {
    return tasks().find((task) => task.id === id)
  }

  async function run(action: string, id: string, fn: () => Promise<{ error?: unknown }>) {
    if (busy() !== null) return
    setBusy(id)
    try {
      const result = await fn()
      if (result.error) {
        toast.show({
          message: requestErrorMessage(result.error, `Failed to ${action} scheduled task`),
          variant: "error",
        })
        return
      }
      await refresh()
    } catch (error) {
      log.warn(`scheduled task ${action} failed`, { error, id })
      toast.show({ message: requestErrorMessage(error, `Failed to ${action} scheduled task`), variant: "error" })
    } finally {
      setBusy(null)
    }
  }

  async function confirmDelete(task: ScheduledTaskInfo) {
    const answer = await DialogConfirm.show(dialog, uiText("ui.deleteTask"), deleteTaskMessage(task))
    if (answer === true) {
      await run("delete", task.id, async () => {
        const result = await sdk.client.scheduledTask.delete({ scheduledTaskID: task.id })
        if (!result.error) toast.show({ message: `Deleted: ${task.title}`, variant: "info" })
        return result
      })
    }
    reopenList()
  }

  async function runBulkCleanup(targets: ScheduledTaskInfo[]) {
    if (busy() !== null || targets.length === 0) return
    setBusy("cleanup")
    let deleted = 0
    try {
      for (const task of targets) {
        const result = await sdk.client.scheduledTask.delete({ scheduledTaskID: task.id })
        if (result.error) {
          toast.show({
            message: requestErrorMessage(result.error, "Failed to delete scheduled task"),
            variant: "error",
          })
          break
        }
        deleted++
      }
      if (deleted > 0) toast.show({ message: cleanupResultMessage(deleted), variant: "success" })
    } catch (error) {
      log.warn("scheduled task cleanup failed", { error })
      toast.show({ message: requestErrorMessage(error, "Failed to clean up scheduled tasks"), variant: "error" })
    } finally {
      setBusy(null)
    }
  }

  async function confirmCleanup(kind: CleanupKind) {
    suppressCleanupCloseReopen = true
    const current = tasks()
    const targets = cleanupTargets(current, kind)
    const answer = await DialogConfirm.show(
      dialog,
      kind === "finished" ? "Clear finished tasks" : "Delete all scheduled tasks",
      cleanupConfirmMessage(current, kind),
    )
    if (answer === true) await runBulkCleanup(targets)
    suppressCleanupCloseReopen = false
    reopenList()
  }

  function openCleanup() {
    suppressCleanupCloseReopen = false
    dialog.replace(
      () => (
        <DialogSelect
          title="Clean up scheduled tasks"
          options={cleanupOptions(tasks())}
          onSelect={(option) => {
            if (option.value !== "finished" && option.value !== "all") return
            void confirmCleanup(option.value)
          }}
        />
      ),
      () => {
        if (!suppressCleanupCloseReopen) reopenList()
      },
    )
  }

  return (
    <DialogSelect
      title={uiText("ui.scheduledTasks")}
      options={options()}
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
          title: uiText("ui.runNow"),
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
          title: uiText("ui.delete"),
          onTrigger: (option) => {
            const task = taskByID(option.value)
            if (!task) return
            void confirmDelete(task)
          },
        },
        {
          keybind: Keybind.parse("ctrl+o")[0],
          title: "clean up",
          onTrigger: () => {
            if (tasks().length === 0) return
            openCleanup()
          },
        },
      ]}
    />
  )
}

function DialogScheduledTaskRuns(props: { task: ScheduledTaskInfo }) {
  const uiText = useLanguage().t

  const dialog = useDialog()
  const route = useRoute()
  const sync = useSync()
  const sdk = useSDK()
  const toast = useToast()

  const [runs, setRuns] = createSignal<ScheduledTaskRunInfo[]>([])
  const [runsState, setRunsState] = createSignal<"loading" | "ready" | "error">("loading")

  onMount(() => {
    sdk.client.scheduledTask
      .listRuns({ scheduledTaskID: props.task.id })
      .then((result) => {
        if (result.error) {
          setRunsState("error")
          log.warn("scheduled task runs load failed", { error: result.error, id: props.task.id })
          toast.show({ message: requestErrorMessage(result.error, "Failed to load runs"), variant: "error" })
          return
        }
        setRuns(result.data ?? [])
        setRunsState("ready")
      })
      .catch((error) => {
        setRunsState("error")
        log.warn("scheduled task runs load failed", { error, id: props.task.id })
        toast.show({ message: requestErrorMessage(error, "Failed to load runs"), variant: "error" })
      })
  })

  function automationSessionID(run: ScheduledTaskRunInfo): string | undefined {
    if (!run.queueID) return undefined
    return sync.data.task_queue.find((item) => item.id === run.queueID)?.sessionID
  }

  const options = createMemo(() => {
    const rows = runs().map((run) => ({
      title: runTitle(run),
      value: run.id,
      description: runDescription(run),
      footer: automationSessionID(run) ? "enter: open session" : uiText("ui.noRecordedAutomationSessionForThisRun"),
    }))
    if (rows.length > 0) return rows
    if (runsState() !== "ready") {
      return [
        {
          title: runsState() === "loading" ? uiText("ui.loading") : "Unable to load runs",
          value: "unavailable",
          disabled: true,
        },
      ]
    }
    return [
      {
        title: "No runs yet",
        value: "empty",
        description: "Run the task now to record its first run.",
        disabled: true,
      },
    ]
  })

  return (
    <DialogSelect
      title={`Runs: ${props.task.title}`}
      options={options()}
      onSelect={(option) => {
        const run = runs().find((item) => item.id === option.value)
        if (!run) return
        const sessionID = automationSessionID(run)
        if (!sessionID) {
          toast.show({ message: uiText("ui.noRecordedAutomationSessionForThisRun"), variant: "info" })
          return
        }
        dialog.clear()
        route.navigate({ type: "session", sessionID })
      }}
    />
  )
}
