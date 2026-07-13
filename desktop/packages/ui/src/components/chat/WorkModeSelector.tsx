import React from "react"
import { Icon } from "@/components/icon/Icon"
import type { IconName } from "@/components/icon/icons"
import { cn } from "@/lib/utils"
import { useDirectoryStore } from "@/stores/useDirectoryStore"
import { useWorkModeStore } from "@/stores/useWorkModeStore"
import { normalizeDirectoryKey } from "@/stores/utils/directoryKey"
import {
  cycleWorkMode,
  DEFAULT_WORK_MODE,
  parseWorkMode,
  type WorkModeId,
} from "@/lib/workMode"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

type ModeMeta = {
  value: WorkModeId
  icon: IconName
  label: string
  hint: string
}

const MODES: ModeMeta[] = [
  {
    value: "agent",
    icon: "robot",
    label: "Agent",
    hint: "Normal single-agent coding (default). Click to cycle: Agent → Council → Arena.",
  },
  {
    value: "council",
    icon: "scales-3",
    label: "Council",
    hint: "Multi-provider advisory review. Click to cycle: Agent → Council → Arena.",
  },
  {
    value: "arena",
    icon: "sparkling",
    label: "Arena",
    hint: "Multi-model best-of-N. Click to cycle: Agent → Council → Arena.",
  },
]

interface WorkModeSelectorProps {
  className?: string
  iconSizeClass?: string
}

/**
 * Single toggle control (same idea as TUI): shows only the active work mode.
 * Click cycles Agent → Council → Arena → Agent. Default is Agent.
 */
export const WorkModeSelector: React.FC<WorkModeSelectorProps> = ({
  className,
  iconSizeClass = "h-[18px] w-[18px]",
}) => {
  const currentDirectory = useDirectoryStore((s) => s.currentDirectory)
  const dirKey = normalizeDirectoryKey(currentDirectory)
  const mode = useWorkModeStore((s) => parseWorkMode(s.modeByDirectory[dirKey], DEFAULT_WORK_MODE))
  const setMode = useWorkModeStore((s) => s.setMode)

  const activeMeta = MODES.find((m) => m.value === mode) ?? MODES[0]!
  const isDefault = mode === "agent"
  const tooltipLabel = `Work mode: ${activeMeta.label} (click to cycle)`

  return (
    <Tooltip delayDuration={350}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={tooltipLabel}
          onClick={() => setMode(currentDirectory, cycleWorkMode(mode))}
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium transition-colors",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            isDefault
              ? "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              : "bg-primary/10 text-primary hover:bg-primary/15",
            className,
          )}
        >
          <Icon name={activeMeta.icon} className={iconSizeClass} />
          <span className="hidden sm:inline max-w-[5rem] truncate">{activeMeta.label}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[16rem] text-xs">
        <p className="font-medium">{activeMeta.label}</p>
        <p className="text-muted-foreground">{activeMeta.hint}</p>
      </TooltipContent>
    </Tooltip>
  )
}
