import React from "react"
import { useI18n } from "@/lib/i18n"
import { Icon } from "@/components/icon/Icon"
import type { IconName } from "@/components/icon/icons"
import { Button } from "@/components/ui/button"
import { useSessionUIStore } from "@/sync/session-ui-store"
import { useProjectsStore } from "@/stores/useProjectsStore"
import { useUIStore } from "@/stores/useUIStore"
import { ProjectsHome } from "@/components/projects/ProjectsHome"
import { sessionEvents } from "@/lib/sessionEvents"
import { cn } from "@/lib/utils"

type Starter = {
  id: string
  icon: IconName
  titleKey:
    | "work.home.starters.planDay.title"
    | "work.home.starters.draft.title"
    | "work.home.starters.research.title"
    | "work.home.starters.summarize.title"
    | "work.home.starters.automate.title"
    | "work.home.starters.agent.title"
  promptKey:
    | "work.home.starters.planDay.prompt"
    | "work.home.starters.draft.prompt"
    | "work.home.starters.research.prompt"
    | "work.home.starters.summarize.prompt"
    | "work.home.starters.automate.prompt"
    | "work.home.starters.agent.prompt"
}

const STARTERS: Starter[] = [
  {
    id: "plan-day",
    icon: "calendar-schedule",
    titleKey: "work.home.starters.planDay.title",
    promptKey: "work.home.starters.planDay.prompt",
  },
  {
    id: "draft",
    icon: "edit-2",
    titleKey: "work.home.starters.draft.title",
    promptKey: "work.home.starters.draft.prompt",
  },
  {
    id: "research",
    icon: "global",
    titleKey: "work.home.starters.research.title",
    promptKey: "work.home.starters.research.prompt",
  },
  {
    id: "summarize",
    icon: "file-text",
    titleKey: "work.home.starters.summarize.title",
    promptKey: "work.home.starters.summarize.prompt",
  },
  {
    id: "automate",
    icon: "robot",
    titleKey: "work.home.starters.automate.title",
    promptKey: "work.home.starters.automate.prompt",
  },
  {
    id: "agent",
    icon: "sparkling",
    titleKey: "work.home.starters.agent.title",
    promptKey: "work.home.starters.agent.prompt",
  },
]

/**
 * Agentic Work surface home — task-first, lighter than the Code IDE shell.
 * Inspired by Codex Work / personal agents: goal in, agent runs multi-step work.
 */
export const WorkHome: React.FC<{ className?: string }> = ({ className }) => {
  const { t } = useI18n()
  const openNewSessionDraft = useSessionUIStore((s) => s.openNewSessionDraft)
  const setActiveMainTab = useUIStore((s) => s.setActiveMainTab)
  const projects = useProjectsStore((s) => s.projects)

  const startTask = React.useCallback(
    (prompt?: string) => {
      setActiveMainTab("chat")
      openNewSessionDraft(prompt ? { initialPrompt: prompt } : undefined)
    },
    [openNewSessionDraft, setActiveMainTab],
  )

  return (
    <div className={cn("flex w-full flex-col gap-8", className)}>
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="typography-ui-header font-medium tracking-tight text-foreground">
          {t("work.home.title")}
        </span>
        <span className="typography-meta max-w-md text-muted-foreground leading-relaxed">
          {t("work.home.subtitle")}
        </span>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <Button type="button" size="sm" onClick={() => startTask()} className="gap-1.5">
            <Icon name="add" className="h-3.5 w-3.5" />
            {t("work.home.actions.newTask")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => sessionEvents.requestDirectoryDialog()}
            className="gap-1.5"
          >
            <Icon name="folder-add" className="h-3.5 w-3.5" />
            {t("work.home.actions.openFolder")}
          </Button>
        </div>
      </div>

      <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
        {STARTERS.map((starter) => (
          <button
            key={starter.id}
            type="button"
            onClick={() => startTask(t(starter.promptKey))}
            className={cn(
              "flex items-start gap-3 rounded-lg border border-border/60 bg-[var(--surface-elevated)] px-3 py-2.5 text-left transition-colors",
              "hover:bg-interactive-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--interactive-focus-ring)]",
            )}
          >
            <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border/50 bg-background">
              <Icon name={starter.icon} className="h-4 w-4 text-muted-foreground" />
            </span>
            <span className="min-w-0">
              <span className="block typography-ui-label font-medium text-foreground">
                {t(starter.titleKey)}
              </span>
              <span className="mt-0.5 block typography-micro text-muted-foreground line-clamp-2">
                {t(starter.promptKey)}
              </span>
            </span>
          </button>
        ))}
      </div>

      {projects.length > 0 ? (
        <div className="border-t border-border/40 pt-6">
          <ProjectsHome
            onOpenProject={() => {
              setActiveMainTab("chat")
              openNewSessionDraft()
            }}
            onNewSession={(projectId) => {
              const project = useProjectsStore.getState().projects.find((p) => p.id === projectId)
              setActiveMainTab("chat")
              openNewSessionDraft({ directoryOverride: project?.path ?? null })
            }}
          />
        </div>
      ) : null}
    </div>
  )
}
