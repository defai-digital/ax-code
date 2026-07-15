import React from "react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import { Icon } from "@/components/icon/Icon"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"

interface ProjectSwitcherProps<TProject extends { id: string }> {
  projects: readonly TProject[]
  selectedProjectId: string | null | undefined
  /** Renders the icon + label for a project (reused for the trigger and list rows). */
  renderLabel: (project: TProject) => React.ReactNode
  /** Plain text used to filter a project against the search term. */
  getSearchText: (project: TProject) => string
  onSelect: (projectId: string) => void
  onAddProject: () => void
  disabled?: boolean
  triggerClassName?: string
}

/**
 * Searchable project switcher for the composer. A chip trigger opens a popover
 * with a search box, the list of projects (folder/home icon + a check on the
 * active one), and a "+ Add project…" action — mirroring the git BranchSelector
 * pattern so it stays consistent with the rest of the app.
 */
export function ProjectSwitcher<TProject extends { id: string }>({
  projects,
  selectedProjectId,
  renderLabel,
  getSearchText,
  onSelect,
  onAddProject,
  disabled = false,
  triggerClassName,
}: ProjectSwitcherProps<TProject>) {
  const { t } = useI18n()
  const [isOpen, setIsOpen] = React.useState(false)
  const [search, setSearch] = React.useState("")

  const selectedProject = React.useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  )

  const filtered = React.useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return projects
    return projects.filter((project) => getSearchText(project).toLowerCase().includes(term))
  }, [projects, search, getSearchText])

  // The command list runs its own typeahead; keep the dropdown's native
  // first-letter typeahead from also firing while typing in the search box.
  const stopDropdownTypeahead = React.useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation()
  }, [])

  React.useEffect(() => {
    if (!isOpen) {
      setSearch("")
    }
  }, [isOpen])

  const handleSelect = React.useCallback(
    (projectId: string) => {
      setIsOpen(false)
      onSelect(projectId)
    },
    [onSelect],
  )

  const handleAddProject = React.useCallback(() => {
    setIsOpen(false)
    onAddProject()
  }, [onAddProject])

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          className={cn(
            "h-7 min-w-0 w-fit max-w-[42vw] justify-start gap-1.5 px-1.5 sm:max-w-[18rem]",
            triggerClassName,
          )}
          aria-label={t("chat.chatInput.switchProject")}
        >
          <span className="flex min-w-0 items-center">
            {selectedProject ? (
              renderLabel(selectedProject)
            ) : (
              <span className="truncate text-muted-foreground">{t("chat.chatInput.selectProject")}</span>
            )}
          </span>
          <Icon name="arrow-down-s" className="h-3.5 w-3.5 shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="flex max-h-[60vh] w-64 flex-col p-0">
        <Command shouldFilter={false} className="h-full min-h-0">
          <CommandInput
            placeholder={t("chat.chatInput.searchProjects")}
            value={search}
            onValueChange={setSearch}
            onKeyDown={stopDropdownTypeahead}
          />
          <CommandList
            scrollbarClassName="overlay-scrollbar--flush overlay-scrollbar--dense overlay-scrollbar--zero"
            disableHorizontal
          >
            {filtered.length === 0 ? (
              <div className="py-6 text-center typography-ui-label">{t("chat.chatInput.noProjectsFound")}</div>
            ) : (
              <CommandGroup>
                {filtered.map((project) => {
                  const isActive = project.id === selectedProjectId
                  return (
                    <CommandItem
                      key={project.id}
                      value={project.id}
                      onSelect={() => handleSelect(project.id)}
                      className="gap-1.5"
                    >
                      <span className="flex min-w-0 flex-1 items-center">{renderLabel(project)}</span>
                      {isActive ? <Icon name="check" className="h-3.5 w-3.5 shrink-0 text-primary" /> : null}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            )}

            <CommandSeparator />

            <CommandGroup>
              <CommandItem value="__add_project__" onSelect={handleAddProject} className="gap-1.5 text-muted-foreground">
                <Icon name="add" className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{t("chat.chatInput.addProject")}</span>
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
