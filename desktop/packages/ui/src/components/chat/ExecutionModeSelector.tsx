import React from "react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Icon } from "@/components/icon/Icon"
import type { IconName } from "@/components/icon/icons"
import { cn } from "@/lib/utils"
import { useI18n, type I18nKey } from "@/lib/i18n"
import { useDirectoryStore } from "@/stores/useDirectoryStore"
import { useExecutionModeStore, type ExecutionMode } from "@/stores/useExecutionModeStore"
import { normalizeDirectoryKey } from "@/stores/utils/directoryKey"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

type ModeMeta = {
  value: ExecutionMode
  icon: IconName
  labelKey: I18nKey
  hintKey: I18nKey
}

const MODES: ModeMeta[] = [
  {
    value: "manual",
    icon: "shield-user",
    labelKey: "chat.chatInput.executionMode.manual",
    hintKey: "chat.chatInput.executionMode.manualHint",
  },
  {
    value: "autonomous",
    icon: "brain-ai-3",
    labelKey: "chat.chatInput.executionMode.autonomous",
    hintKey: "chat.chatInput.executionMode.autonomousHint",
  },
  {
    value: "long-run",
    icon: "timer",
    labelKey: "chat.chatInput.executionMode.longRun",
    hintKey: "chat.chatInput.executionMode.longRunHint",
  },
]

interface ExecutionModeSelectorProps {
  className?: string
  iconSizeClass?: string
}

export const ExecutionModeSelector: React.FC<ExecutionModeSelectorProps> = ({
  className,
  iconSizeClass = "h-[18px] w-[18px]",
}) => {
  const { t } = useI18n()
  const currentDirectory = useDirectoryStore((s) => s.currentDirectory)
  // Must match the key the store writes under (normalizeDirectoryKey), not a
  // plain trim — otherwise unnormalized paths (trailing slash, backslashes)
  // subscribe to a key the store never populates.
  const dirKey = normalizeDirectoryKey(currentDirectory)

  const mode = useExecutionModeStore((s) => s.modeByDirectory[dirKey])
  const pending = useExecutionModeStore((s) => s.pendingByDirectory[dirKey] === true)
  const loadMode = useExecutionModeStore((s) => s.loadMode)
  const setMode = useExecutionModeStore((s) => s.setMode)

  React.useEffect(() => {
    void loadMode(currentDirectory)
  }, [currentDirectory, loadMode])

  const activeMeta = MODES.find((m) => m.value === mode)
  const title = t("chat.chatInput.executionMode.title")
  const activeLabel = activeMeta ? t(activeMeta.labelKey) : title
  const tooltipLabel = activeMeta ? `${title}: ${activeLabel}` : title

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={tooltipLabel}
              className={cn(
                "flex h-7 w-7 flex-shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none transition-colors",
                "hover:bg-interactive-hover hover:text-foreground",
                "focus-visible:ring-2 focus-visible:ring-[var(--interactive-focus-ring)]",
                "data-[state=open]:bg-interactive-selection data-[state=open]:text-foreground",
                className,
              )}
            >
              <Icon
                name={pending ? "loader-4" : (activeMeta?.icon ?? "shield-user")}
                className={cn(iconSizeClass, "flex-shrink-0", pending && "animate-spin")}
              />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={8}>
          {tooltipLabel}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="min-w-[260px]">
        <DropdownMenuLabel className="typography-meta text-muted-foreground">{title}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={mode ?? ""}
          onValueChange={(value) => {
            if (pending) return
            void setMode(currentDirectory, value as ExecutionMode)
          }}
        >
          {MODES.map((option) => (
            <DropdownMenuRadioItem
              key={option.value}
              value={option.value}
              disabled={pending}
              className="items-start gap-2"
            >
              <Icon name={option.icon} className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span className="flex min-w-0 flex-col">
                <span className="typography-meta text-foreground">{t(option.labelKey)}</span>
                <span className="typography-micro text-muted-foreground">{t(option.hintKey)}</span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
