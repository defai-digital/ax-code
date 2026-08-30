import * as React from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { MobileOverlayPanel } from "@/components/ui/MobileOverlayPanel"
import { ViewLoadingSkeleton } from "@/components/ui/ViewLoadingSkeleton"
import { toast } from "@/components/ui"
import { useConfirmDialog } from "@/components/ui/ConfirmDialog"
import { Icon } from "@/components/icon/Icon"
import type { IconName } from "@/components/icon/icons"
import { useUIStore } from "@/stores/useUIStore"
import { useProjectsStore } from "@/stores/useProjectsStore"
import { useDirectoryStore } from "@/stores/useDirectoryStore"
import { refreshGlobalSessions } from "@/stores/useGlobalSessionsStore"
import { subscribeScheduledTaskEvents } from "@/lib/scheduledTaskEvents"
import { PROJECT_COLOR_MAP, PROJECT_ICON_MAP, getProjectIconImageUrl } from "@/lib/projectMeta"
import { useThemeSystem } from "@/contexts/useThemeSystem"
import { cn, formatDirectoryName } from "@/lib/utils"
import { useI18n } from "@/lib/i18n"
import type { ProjectEntry } from "@/lib/api/types"
import {
  createScheduledTasks,
  deleteScheduledTask,
  expandPromptSnippets,
  fetchScheduledTasks,
  runScheduledTaskNow,
  setScheduledTaskEnabled,
  updateScheduledTask,
  type ScheduledTask,
  type ScheduledTaskRunDisplayStatus,
} from "@/lib/scheduledTasksApi"
import {
  buildRuntimeScheduledTaskPayloads,
  type RuntimeSchedule,
  type ScheduledTaskDraftInput,
} from "@/lib/scheduledTaskTransform"
import { ScheduledTaskEditorDialog } from "./ScheduledTaskEditorDialog"
import { loadCurrentScheduledTaskList } from "./scheduledTaskListLoad"
import { relativeTimeParts } from "./scheduledTaskRelativeTime"

const pad2 = (value: number): string => String(value).padStart(2, "0")

const formatSchedule = (task: ScheduledTask, t: ReturnType<typeof useI18n>["t"]): string => {
  const schedule = task.schedule as RuntimeSchedule
  const timezone = "timezone" in schedule ? schedule.timezone : undefined
  const formatWeekday = (value: number) => {
    if (value === 0) return t("sessions.scheduledTasks.dialog.schedule.weekdayShort.sun")
    if (value === 1) return t("sessions.scheduledTasks.dialog.schedule.weekdayShort.mon")
    if (value === 2) return t("sessions.scheduledTasks.dialog.schedule.weekdayShort.tue")
    if (value === 3) return t("sessions.scheduledTasks.dialog.schedule.weekdayShort.wed")
    if (value === 4) return t("sessions.scheduledTasks.dialog.schedule.weekdayShort.thu")
    if (value === 5) return t("sessions.scheduledTasks.dialog.schedule.weekdayShort.fri")
    if (value === 6) return t("sessions.scheduledTasks.dialog.schedule.weekdayShort.sat")
    return t("sessions.scheduledTasks.dialog.schedule.weekdayShort.unknown")
  }
  if (schedule.type === "daily") {
    if (timezone) {
      return t("sessions.scheduledTasks.dialog.schedule.dailyWithTimezone", {
        time: schedule.time,
        timezone,
      })
    }
    return t("sessions.scheduledTasks.dialog.schedule.daily", { time: schedule.time })
  }
  if (schedule.type === "weekly") {
    const days = formatWeekday(schedule.day)
    if (timezone) {
      return t("sessions.scheduledTasks.dialog.schedule.weeklyWithTimezone", {
        days,
        time: schedule.time,
        timezone,
      })
    }
    return t("sessions.scheduledTasks.dialog.schedule.weekly", { days, time: schedule.time })
  }
  if (schedule.type === "once") {
    const runAt = new Date(schedule.runAt)
    const date = `${runAt.getFullYear()}-${pad2(runAt.getMonth() + 1)}-${pad2(runAt.getDate())}`
    const time = `${pad2(runAt.getHours())}:${pad2(runAt.getMinutes())}`
    return t("sessions.scheduledTasks.dialog.schedule.once", { date, time })
  }
  if (timezone) {
    return t("sessions.scheduledTasks.dialog.schedule.cronWithTimezone", {
      cron: schedule.expression,
      timezone,
    })
  }
  return t("sessions.scheduledTasks.dialog.schedule.cron", { cron: schedule.expression })
}

const formatClockTime = (value?: number): string => {
  if (!value || !Number.isFinite(value)) {
    return ""
  }
  return new Date(value).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
}

const formatRelativeTime = (value: number | undefined, t: ReturnType<typeof useI18n>["t"]): string => {
  const parts = relativeTimeParts(value)
  switch (parts.kind) {
    case "empty":
      return ""
    case "seconds":
      return parts.future
        ? t("sessions.scheduledTasks.dialog.relativeTime.inLessThanOneMinute")
        : t("sessions.scheduledTasks.dialog.relativeTime.justNow")
    case "minutes":
      return parts.future
        ? t("sessions.scheduledTasks.dialog.relativeTime.inMinutes", { count: parts.count })
        : t("sessions.scheduledTasks.dialog.relativeTime.minutesAgo", { count: parts.count })
    case "duration":
      return parts.future
        ? t("sessions.scheduledTasks.dialog.relativeTime.inDuration", { duration: parts.body })
        : t("sessions.scheduledTasks.dialog.relativeTime.durationAgo", { duration: parts.body })
  }
}

type ScheduledTaskStatusTone = "success" | "error" | "warning" | "muted"

const STATUS_META: Record<
  ScheduledTaskRunDisplayStatus,
  {
    tone: ScheduledTaskStatusTone
    Icon: IconName
    spin?: boolean
  }
> = {
  success: { tone: "success", Icon: "checkbox-circle" },
  error: { tone: "error", Icon: "error-warning" },
  running: { tone: "warning", Icon: "loader-4", spin: true },
  idle: { tone: "muted", Icon: "pulse" },
}

const toneStyle = (tone: ScheduledTaskStatusTone): React.CSSProperties => {
  if (tone === "muted") {
    return {}
  }
  return {
    color: `var(--status-${tone})`,
    backgroundColor: `var(--status-${tone}-background)`,
    borderColor: `var(--status-${tone}-border)`,
  }
}

export function ScheduledTasksDialog() {
  const { t } = useI18n()
  const open = useUIStore((state) => state.isScheduledTasksDialogOpen)
  const setOpen = useUIStore((state) => state.setScheduledTasksDialogOpen)
  const isMobile = useUIStore((state) => state.isMobile)
  const projects = useProjectsStore((state) => state.projects)
  const activeProject = useProjectsStore((state) => state.getActiveProject())
  const homeDirectory = useDirectoryStore((state) => state.homeDirectory)
  const { currentTheme } = useThemeSystem()

  const [selectedProjectID, setSelectedProjectID] = React.useState<string>("")
  const [tasks, setTasks] = React.useState<ScheduledTask[]>([])
  // Start in loading state so the first frame after open shows the spinner,
  // not an empty/select-project flash before the fetch effect runs.
  const [loading, setLoading] = React.useState(true)
  const [editorOpen, setEditorOpen] = React.useState(false)
  const [editorTask, setEditorTask] = React.useState<ScheduledTask | null>(null)
  const [mutatingTaskID, setMutatingTaskID] = React.useState<string | null>(null)
  const { requestConfirm, confirmDialog } = useConfirmDialog()
  const taskListRequestRef = React.useRef(0)
  const selectedProjectIDRef = React.useRef("")
  const openRef = React.useRef(false)

  React.useEffect(() => {
    openRef.current = open
    if (!open) {
      taskListRequestRef.current += 1
      setLoading(false)
      setMutatingTaskID(null)
    }
  }, [open])

  const selectedProject = React.useMemo(
    () => projects.find((project) => project.id === selectedProjectID) || null,
    [projects, selectedProjectID],
  )

  const renderProjectLabel = React.useCallback(
    (project: ProjectEntry) => {
      const displayLabel = project.label?.trim() || formatDirectoryName(project.path, homeDirectory || undefined)
      const imageUrl = getProjectIconImageUrl(
        { id: project.id, iconImage: project.iconImage ?? null },
        {
          themeVariant: currentTheme.metadata.variant,
          iconColor: currentTheme.colors.surface.foreground,
        },
      )
      const projectIconName = project.icon ? PROJECT_ICON_MAP[project.icon] : null
      const iconColor = project.color ? PROJECT_COLOR_MAP[project.color] : undefined

      return (
        <span className="inline-flex min-w-0 items-center gap-1.5">
          {imageUrl ? (
            <span
              className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center overflow-hidden rounded-[3px]"
              style={project.iconBackground ? { backgroundColor: project.iconBackground } : undefined}
            >
              <img src={imageUrl} alt="" className="h-full w-full object-contain" draggable={false} />
            </span>
          ) : projectIconName ? (
            <Icon
              name={projectIconName}
              className="h-3.5 w-3.5 shrink-0"
              style={iconColor ? { color: iconColor } : undefined}
            />
          ) : (
            <Icon
              name="folder"
              className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
              style={iconColor ? { color: iconColor } : undefined}
            />
          )}
          <span className="truncate">{displayLabel}</span>
        </span>
      )
    },
    [homeDirectory, currentTheme.metadata.variant, currentTheme.colors.surface.foreground],
  )

  // Runtime scheduled tasks are scoped by project directory (the runtime's
  // `?directory=` instance key), not by the desktop project id.
  const directoryForProject = React.useCallback(
    (projectID: string): string => projects.find((project) => project.id === projectID)?.path || "",
    [projects],
  )

  const reloadTasks = React.useCallback(
    async (projectID: string, options?: { silent?: boolean }) => {
      const requestId = taskListRequestRef.current + 1
      taskListRequestRef.current = requestId

      const directory = directoryForProject(projectID)
      if (!projectID || !directory) {
        setTasks([])
        if (!options?.silent) {
          setLoading(false)
        }
        return
      }
      if (!options?.silent) {
        setLoading(true)
      }
      const loaded = await loadCurrentScheduledTaskList({
        load: () => fetchScheduledTasks(directory),
        isCurrent: () =>
          openRef.current && selectedProjectIDRef.current === projectID && taskListRequestRef.current === requestId,
      })
      if (loaded.status === "loaded") {
        const nextTasks = loaded.tasks
        nextTasks.sort((a, b) => {
          const aActive = a.status === "active"
          const bActive = b.status === "active"
          if (aActive !== bActive) {
            return aActive ? -1 : 1
          }
          const byName = a.title.localeCompare(b.title)
          if (byName !== 0) {
            return byName
          }
          return (a.nextRunAt || Number.MAX_SAFE_INTEGER) - (b.nextRunAt || Number.MAX_SAFE_INTEGER)
        })
        setTasks(nextTasks)
      } else if (loaded.status === "failed") {
        toast.error(
          loaded.error instanceof Error ? loaded.error.message : t("sessions.scheduledTasks.dialog.toast.loadFailed"),
        )
        if (!options?.silent) {
          setTasks([])
        }
      }
      if (taskListRequestRef.current === requestId) {
        setLoading(false)
      }
    },
    [directoryForProject, t],
  )

  React.useEffect(() => {
    if (!open) {
      return
    }
    const preferredProjectID = activeProject?.id || projects[0]?.id || ""
    selectedProjectIDRef.current = preferredProjectID
    setSelectedProjectID(preferredProjectID)
    if (preferredProjectID) {
      void reloadTasks(preferredProjectID)
    } else {
      setTasks([])
      setLoading(false)
    }
  }, [open, activeProject, projects, reloadTasks])

  React.useEffect(() => {
    if (!open) {
      return
    }
    let timeoutID: ReturnType<typeof setTimeout> | null = null
    const unsubscribe = subscribeScheduledTaskEvents((event) => {
      const directory = directoryForProject(selectedProjectID)
      // Events without a directory (e.g. scheduled.task.deleted) always
      // trigger a refresh; directory-scoped events must match the selection.
      if (event.directory && directory && event.directory !== directory) {
        return
      }
      if (timeoutID) {
        clearTimeout(timeoutID)
      }
      timeoutID = setTimeout(() => {
        void reloadTasks(selectedProjectID, { silent: true })
      }, 400)
    })
    return () => {
      if (timeoutID) {
        clearTimeout(timeoutID)
      }
      unsubscribe()
    }
  }, [open, selectedProjectID, reloadTasks, directoryForProject])

  const handleSaveTask = React.useCallback(
    async (submit: { id?: string; enabled: boolean; input: ScheduledTaskDraftInput }) => {
      const directory = directoryForProject(selectedProjectID)
      if (!selectedProjectID || !directory) {
        throw new Error(t("sessions.scheduledTasks.dialog.error.chooseProjectFirst"))
      }
      // Client-side fan-out: a multi-time/multi-weekday draft becomes N
      // runtime tasks (same naming as the S2.6 migration). When editing, the
      // first slot updates the edited task and any extra slots become new
      // sibling tasks. Snippet references are pre-expanded — the runtime
      // executes the stored prompt verbatim.
      const prompt = await expandPromptSnippets(directory, submit.input.prompt)
      const payloads = buildRuntimeScheduledTaskPayloads({ ...submit.input, prompt })
      if (!payloads || payloads.length === 0) {
        throw new Error(t("sessions.scheduledTasks.dialog.toast.updateFailed"))
      }
      if (submit.id) {
        const [first, ...rest] = payloads
        await updateScheduledTask(directory, submit.id, {
          title: first.title,
          prompt: first.prompt,
          schedule: first.schedule,
          ...(first.agent ? { agent: first.agent } : {}),
          ...(first.model ? { model: first.model } : {}),
          catchUpPolicy: first.catchUpPolicy,
          status: submit.enabled ? "active" : "paused",
        })
        if (rest.length > 0) {
          await createScheduledTasks(directory, rest, { pause: !submit.enabled })
        }
      } else {
        await createScheduledTasks(directory, payloads, { pause: !submit.enabled })
      }
      await reloadTasks(selectedProjectID)
      toast.success(t("sessions.scheduledTasks.dialog.toast.saved"))
    },
    [selectedProjectID, directoryForProject, reloadTasks, t],
  )

  const handleToggleEnabled = React.useCallback(
    async (task: ScheduledTask, enabled: boolean) => {
      const directory = directoryForProject(selectedProjectID)
      if (!selectedProjectID || !directory) {
        return
      }
      setMutatingTaskID(task.id)
      setTasks((prev) =>
        prev.map((item) => (item.id === task.id ? { ...item, status: enabled ? "active" : "paused" } : item)),
      )
      try {
        await setScheduledTaskEnabled(directory, task.id, enabled)
        await reloadTasks(selectedProjectID, { silent: true })
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t("sessions.scheduledTasks.dialog.toast.updateFailed"))
        await reloadTasks(selectedProjectID, { silent: true })
      } finally {
        setMutatingTaskID(null)
      }
    },
    [selectedProjectID, directoryForProject, reloadTasks, t],
  )

  const handleDeleteTask = React.useCallback(
    async (task: ScheduledTask) => {
      const directory = directoryForProject(selectedProjectID)
      if (!selectedProjectID || !directory) {
        return
      }
      const confirmed = await requestConfirm(
        t("sessions.scheduledTasks.dialog.confirm.deleteTask", { taskName: task.title }),
        { destructive: true },
      )
      if (!confirmed) {
        return
      }

      setMutatingTaskID(task.id)
      try {
        await deleteScheduledTask(directory, task.id)
        await reloadTasks(selectedProjectID, { silent: true })
        toast.success(t("sessions.scheduledTasks.dialog.toast.deleted"))
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t("sessions.scheduledTasks.dialog.toast.deleteFailed"))
      } finally {
        setMutatingTaskID(null)
      }
    },
    [selectedProjectID, directoryForProject, reloadTasks, t, requestConfirm],
  )

  const handleRunNow = React.useCallback(
    async (task: ScheduledTask) => {
      const directory = directoryForProject(selectedProjectID)
      if (!selectedProjectID || !directory) {
        return
      }
      setMutatingTaskID(task.id)
      try {
        await runScheduledTaskNow(directory, task.id)
        await Promise.all([reloadTasks(selectedProjectID, { silent: true }), refreshGlobalSessions()])
        toast.success(t("sessions.scheduledTasks.dialog.toast.started"))
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t("sessions.scheduledTasks.dialog.toast.runFailed"))
      } finally {
        setMutatingTaskID(null)
      }
    },
    [selectedProjectID, directoryForProject, reloadTasks, t],
  )

  const projectSelector = (
    <div className="flex flex-col items-start gap-1">
      <span className="typography-meta text-muted-foreground">{t("sessions.scheduledTasks.dialog.project.label")}</span>
      <Select
        value={selectedProjectID || "__none"}
        onValueChange={(value) => {
          const nextProjectID = value === "__none" ? "" : value
          selectedProjectIDRef.current = nextProjectID
          setSelectedProjectID(nextProjectID)
          void reloadTasks(nextProjectID)
        }}
      >
        <SelectTrigger className={isMobile ? "w-full" : undefined}>
          {selectedProject ? (
            <SelectValue>{renderProjectLabel(selectedProject)}</SelectValue>
          ) : (
            <SelectValue placeholder={t("sessions.scheduledTasks.dialog.project.placeholder")} />
          )}
        </SelectTrigger>
        <SelectContent>
          {projects.length === 0 ? (
            <SelectItem value="__none">{t("sessions.scheduledTasks.dialog.project.empty")}</SelectItem>
          ) : null}
          {projects.map((project) => (
            <SelectItem key={project.id} value={project.id}>
              {renderProjectLabel(project)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )

  const openNewTaskEditor = () => {
    setEditorTask(null)
    setEditorOpen(true)
  }

  const tasksContent = (
    <div className="space-y-4">
      {!isMobile ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {projectSelector}
          <Button onClick={openNewTaskEditor} disabled={!selectedProjectID}>
            <Icon name="add" className="mr-1 h-4 w-4" /> {t("sessions.scheduledTasks.dialog.actions.newTask")}
          </Button>
        </div>
      ) : (
        projectSelector
      )}

      <div className="min-h-[280px]">
        {loading ? (
          <ViewLoadingSkeleton rows={4} label={t("sessions.scheduledTasks.dialog.loading")} />
        ) : tasks.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-4 typography-meta text-muted-foreground">
            {selectedProjectID
              ? t("sessions.scheduledTasks.dialog.empty.noTasks")
              : t("sessions.scheduledTasks.dialog.empty.selectProject")}
          </div>
        ) : (
          <div className="space-y-2.5">
            {tasks.map((task) => {
              const isBusy = mutatingTaskID === task.id
              const isActive = task.status === "active"
              const status = task.lastRunStatus
              const meta = STATUS_META[status]
              const statusLabel =
                status === "success"
                  ? t("sessions.scheduledTasks.dialog.status.success")
                  : status === "error"
                    ? t("sessions.scheduledTasks.dialog.status.error")
                    : status === "running"
                      ? t("sessions.scheduledTasks.dialog.status.running")
                      : t("sessions.scheduledTasks.dialog.status.idle")
              const nextAt = task.nextRunAt
              const lastAt = task.lastRunAt

              return (
                <div
                  key={task.id}
                  className={cn("rounded-lg border border-border p-4 transition-opacity", !isActive && "opacity-60")}
                >
                  <div className="min-w-0">
                    <div className="typography-ui-header truncate font-semibold text-foreground">{task.title}</div>
                    <div className="typography-micro truncate text-muted-foreground">{formatSchedule(task, t)}</div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 typography-micro text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <Icon name="timer" className="h-3.5 w-3.5" />
                      <span className="font-medium text-foreground">
                        {t("sessions.scheduledTasks.dialog.nextRun.label")}
                      </span>
                      {nextAt ? (
                        <>
                          <span className="text-foreground">{formatRelativeTime(nextAt, t)}</span>
                          <span className="text-muted-foreground">·</span>
                          <span>{formatClockTime(nextAt)}</span>
                        </>
                      ) : (
                        <span>—</span>
                      )}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <Icon name="history" className="h-3.5 w-3.5" />
                      <span className="font-medium text-foreground">
                        {t("sessions.scheduledTasks.dialog.lastRun.label")}
                      </span>
                      {status === "running" ? (
                        <span className="inline-flex items-center gap-1" style={{ color: "var(--status-warning)" }}>
                          <Icon name="loader-4" className="h-3.5 w-3.5 animate-spin" />
                          {t("sessions.scheduledTasks.dialog.lastRun.runningNow")}
                        </span>
                      ) : lastAt ? (
                        <>
                          {meta.tone !== "muted" ? (
                            <span
                              className="inline-flex items-center gap-1"
                              style={{ color: `var(--status-${meta.tone})` }}
                            >
                              <Icon name={meta.Icon} className="h-3.5 w-3.5" />
                              {statusLabel}
                            </span>
                          ) : null}
                          <span className="text-muted-foreground">·</span>
                          <span>{formatRelativeTime(lastAt, t)}</span>
                        </>
                      ) : (
                        <span>{t("sessions.scheduledTasks.dialog.lastRun.never")}</span>
                      )}
                    </span>
                  </div>

                  {task.lastError ? (
                    <div
                      className="mt-3 flex items-start gap-2 rounded-md border p-2 typography-micro"
                      style={toneStyle("error")}
                    >
                      <Icon name="error-warning" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span className="min-w-0 break-words">{task.lastError}</span>
                    </div>
                  ) : null}

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                    <label
                      className={cn(
                        "inline-flex cursor-pointer items-center gap-2 typography-micro font-medium",
                        isActive ? "text-foreground" : "text-muted-foreground",
                        isBusy && "cursor-not-allowed opacity-50",
                      )}
                    >
                      <Checkbox
                        checked={isActive}
                        onChange={(enabled) => void handleToggleEnabled(task, enabled)}
                        ariaLabel={
                          isActive
                            ? t("sessions.scheduledTasks.dialog.taskToggle.pauseAria", { taskName: task.title })
                            : t("sessions.scheduledTasks.dialog.taskToggle.enableAria", { taskName: task.title })
                        }
                        disabled={isBusy}
                      />
                      {isActive
                        ? t("sessions.scheduledTasks.dialog.taskToggle.enabled")
                        : t("sessions.scheduledTasks.dialog.taskToggle.paused")}
                    </label>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <Button variant="outline" size="sm" onClick={() => void handleRunNow(task)} disabled={isBusy}>
                        <Icon name="play" className="h-4 w-4" /> {t("sessions.scheduledTasks.dialog.actions.runNow")}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setEditorTask(task)
                          setEditorOpen(true)
                        }}
                        disabled={isBusy}
                        aria-label={t("sessions.scheduledTasks.dialog.actions.editAria", { taskName: task.title })}
                      >
                        <Icon name="edit-2" className="h-4 w-4" /> {t("sessions.scheduledTasks.dialog.actions.edit")}
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => void handleDeleteTask(task)}
                        disabled={isBusy}
                        aria-label={t("sessions.scheduledTasks.dialog.actions.deleteAria", { taskName: task.title })}
                      >
                        <Icon name="delete-bin" className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )

  return (
    <>
      {isMobile ? (
        <MobileOverlayPanel
          open={open}
          title={t("sessions.scheduledTasks.dialog.title")}
          onClose={() => setOpen(false)}
          contentMaxHeightClassName="max-h-[min(80vh,640px)]"
          renderHeader={(closeButton) => (
            <div className="flex flex-col gap-1 border-b border-border/40 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <h2 className="typography-ui-label font-semibold text-foreground">
                  {t("sessions.scheduledTasks.dialog.title")}
                </h2>
                {closeButton}
              </div>
              <p className="typography-micro text-muted-foreground">
                {t("sessions.scheduledTasks.dialog.description")}
              </p>
            </div>
          )}
          footer={
            <Button className="w-full" onClick={openNewTaskEditor} disabled={!selectedProjectID}>
              <Icon name="add" className="mr-1 h-4 w-4" /> {t("sessions.scheduledTasks.dialog.actions.newTask")}
            </Button>
          }
        >
          {tasksContent}
        </MobileOverlayPanel>
      ) : (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{t("sessions.scheduledTasks.dialog.title")}</DialogTitle>
              <DialogDescription>{t("sessions.scheduledTasks.dialog.description")}</DialogDescription>
            </DialogHeader>

            {tasksContent}
          </DialogContent>
        </Dialog>
      )}

      <ScheduledTaskEditorDialog
        open={editorOpen}
        task={editorTask}
        onOpenChange={setEditorOpen}
        onSave={handleSaveTask}
      />
      {confirmDialog}
    </>
  )
}
