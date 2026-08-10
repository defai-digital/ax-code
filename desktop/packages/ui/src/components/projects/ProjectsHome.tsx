import React from "react"
import type { ProjectEntry } from "@/lib/api/types"
import { useProjectsStore } from "@/stores/useProjectsStore"
import { useDirectoryStore } from "@/stores/useDirectoryStore"
import { useI18n } from "@/lib/i18n"
import { Icon } from "@/components/icon/Icon"
import { Button } from "@/components/ui/button"
import { cn, formatPathForDisplay } from "@/lib/utils"
import { PROJECT_COLOR_MAP, PROJECT_ICON_MAP, getProjectIconImageUrl } from "@/lib/projectMeta"
import { sortProjectsForDisplay } from "@/lib/projectOrdering"
import { formatProjectLastUsed } from "@/lib/projectLastUsed"
import { useThemeSystem } from "@/contexts/useThemeSystem"
import { sessionEvents } from "@/lib/sessionEvents"
import { ImportProjectsDialog } from "@/components/projects/ImportProjectsDialog"

type ProjectsHomeProps = {
  /** When true, render a denser list suitable for the sidebar empty state. */
  compact?: boolean
  className?: string
  onOpenProject?: (projectId: string) => void
  onNewSession?: (projectId: string) => void
}

export const ProjectsHome: React.FC<ProjectsHomeProps> = ({
  compact = false,
  className,
  onOpenProject,
  onNewSession,
}) => {
  const { t } = useI18n()
  const { currentTheme } = useThemeSystem()
  const projects = useProjectsStore((state) => state.projects)
  const activeProjectId = useProjectsStore((state) => state.activeProjectId)
  const setActiveProject = useProjectsStore((state) => state.setActiveProject)
  const setProjectPinned = useProjectsStore((state) => state.setProjectPinned)
  const homeDirectory = useDirectoryStore((state) => state.homeDirectory)
  const [importOpen, setImportOpen] = React.useState(false)
  const [brokenIconIds, setBrokenIconIds] = React.useState<Set<string>>(new Set())

  const ordered = React.useMemo(() => sortProjectsForDisplay(projects), [projects])

  const handleAddProject = React.useCallback(() => {
    sessionEvents.requestDirectoryDialog()
  }, [])

  const handleOpen = React.useCallback(
    (project: ProjectEntry) => {
      setActiveProject(project.id)
      onOpenProject?.(project.id)
    },
    [onOpenProject, setActiveProject],
  )

  const handleNewSession = React.useCallback(
    (project: ProjectEntry, event: React.MouseEvent) => {
      event.stopPropagation()
      setActiveProject(project.id)
      onNewSession?.(project.id)
    },
    [onNewSession, setActiveProject],
  )

  const handleTogglePin = React.useCallback(
    (project: ProjectEntry, event: React.MouseEvent) => {
      event.stopPropagation()
      setProjectPinned(project.id, project.pinned !== true)
    },
    [setProjectPinned],
  )

  if (ordered.length === 0) {
    return (
      <div className={cn("flex w-full flex-col items-center text-center", compact ? "gap-3 py-4" : "gap-5 py-2", className)}>
        <div className={cn("flex flex-col items-center", compact ? "gap-1.5" : "gap-2")}>
          <span className={cn("font-medium text-foreground", compact ? "typography-ui-label" : "typography-ui-header")}>
            {t("projects.home.empty.title")}
          </span>
          <span className="typography-meta max-w-sm text-muted-foreground leading-relaxed">
            {t("projects.home.empty.description")}
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button type="button" size="sm" onClick={handleAddProject} className="gap-1.5">
            <Icon name="folder-add" className="h-3.5 w-3.5" />
            {t("projects.home.actions.addProject")}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setImportOpen(true)} className="gap-1.5">
            <Icon name="download-cloud" className="h-3.5 w-3.5" />
            {t("projects.home.actions.import")}
          </Button>
        </div>
        <ImportProjectsDialog open={importOpen} onOpenChange={setImportOpen} />
      </div>
    )
  }

  return (
    <div className={cn("flex w-full flex-col", compact ? "gap-2" : "gap-3", className)}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className={cn("font-semibold text-foreground", compact ? "typography-ui-label" : "typography-ui-header")}>
            {t("projects.home.title")}
          </h2>
          {!compact ? (
            <p className="typography-meta mt-0.5 text-muted-foreground">{t("projects.home.subtitle")}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setImportOpen(true)}
            className="h-7 gap-1 px-2 text-muted-foreground"
          >
            <Icon name="download-cloud" className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t("projects.home.actions.import")}</span>
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={handleAddProject} className="h-7 gap-1 px-2">
            <Icon name="folder-add" className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t("projects.home.actions.addProject")}</span>
          </Button>
        </div>
      </div>

      <div className={cn("grid w-full gap-2", compact ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2")}>
        {ordered.map((project) => {
          const isActive = project.id === activeProjectId
          const imageFailureKey = `${project.id}:${project.iconImage?.updatedAt ?? 0}`
          const imageUrl = brokenIconIds.has(imageFailureKey)
            ? null
            : getProjectIconImageUrl(project, {
                themeVariant: currentTheme.metadata.variant,
                iconColor: currentTheme.colors.surface.foreground,
              })
          const iconName = project.icon ? PROJECT_ICON_MAP[project.icon] : null
          const color = project.color ? (PROJECT_COLOR_MAP[project.color] ?? null) : null
          const lastUsed = formatProjectLastUsed(project.lastOpenedAt, t)
          const pathLabel = formatPathForDisplay(project.path, homeDirectory)
          const title = project.label?.trim() || pathLabel

          return (
            <button
              key={project.id}
              type="button"
              onClick={() => handleOpen(project)}
              className={cn(
                "group flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                "bg-[var(--surface-elevated)] hover:bg-interactive-hover",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--interactive-focus-ring)]",
                isActive ? "border-primary/50 ring-1 ring-primary/20" : "border-border/60",
              )}
            >
              <span
                className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border/50 bg-background"
                style={project.iconBackground ? { backgroundColor: project.iconBackground } : undefined}
              >
                {imageUrl ? (
                  <img
                    src={imageUrl}
                    alt=""
                    className="h-full w-full object-contain"
                    draggable={false}
                    onError={() => {
                      setBrokenIconIds((prev) => {
                        if (prev.has(imageFailureKey)) return prev
                        const next = new Set(prev)
                        next.add(imageFailureKey)
                        return next
                      })
                    }}
                  />
                ) : iconName ? (
                  <Icon name={iconName} className="h-4 w-4" style={color ? { color } : undefined} />
                ) : (
                  <Icon name="folder" className="h-4 w-4 text-muted-foreground" style={color ? { color } : undefined} />
                )}
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate typography-ui-label font-medium text-foreground">{title}</span>
                  {project.pinned ? (
                    <Icon name="pushpin-2-fill" className="h-3 w-3 shrink-0 text-primary" aria-hidden />
                  ) : null}
                </span>
                <span className="mt-0.5 block truncate typography-micro text-muted-foreground">{pathLabel}</span>
                <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 typography-micro text-muted-foreground">
                  <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    {t("projects.home.status.ready")}
                  </span>
                  {lastUsed ? <span>{lastUsed}</span> : null}
                </span>
              </span>

              <span className="flex shrink-0 flex-col items-end gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(event) => handleTogglePin(project, event)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault()
                      handleTogglePin(project, event as unknown as React.MouseEvent)
                    }
                  }}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground"
                  aria-label={
                    project.pinned ? t("projects.home.actions.unpin") : t("projects.home.actions.pin")
                  }
                >
                  <Icon
                    name={project.pinned ? "pushpin-2-fill" : "pushpin-2"}
                    className="h-3.5 w-3.5"
                  />
                </span>
                {onNewSession ? (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(event) => handleNewSession(project, event)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault()
                        handleNewSession(project, event as unknown as React.MouseEvent)
                      }
                    }}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground"
                    aria-label={t("projects.home.actions.newSession")}
                  >
                    <Icon name="add" className="h-3.5 w-3.5" />
                  </span>
                ) : null}
              </span>
            </button>
          )
        })}
      </div>

      <ImportProjectsDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  )
}
