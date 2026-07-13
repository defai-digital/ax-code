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
  /** Tailwind classes for the single cycling toggle button */
  buttonClass: string
}

const MODES: ModeMeta[] = [
  {
    value: "agent",
    icon: "robot",
    label: "Agent",
    hint: "Normal single-agent coding (default). Click to cycle: Agent → Council → Arena.",
    // Green
    buttonClass:
      "bg-emerald-500/15 text-emerald-700 border border-emerald-500/35 hover:bg-emerald-500/25 dark:text-emerald-300 dark:border-emerald-400/40",
  },
  {
    value: "council",
    icon: "scales-3",
    label: "Council",
    hint: "Multi-provider advisory review. Click to cycle: Agent → Council → Arena.",
    // Blue
    buttonClass:
      "bg-blue-500/15 text-blue-700 border border-blue-500/35 hover:bg-blue-500/25 dark:text-blue-300 dark:border-blue-400/40",
  },
  {
    value: "arena",
    icon: "sparkling",
    label: "Arena",
    hint: "Multi-model best-of-N. Click to cycle: Agent → Council → Arena.",
    // Yellow
    buttonClass:
      "bg-amber-400/20 text-amber-800 border border-amber-500/40 hover:bg-amber-400/30 dark:text-amber-200 dark:border-amber-400/45",
  },
]

interface WorkModeSelectorProps {
  className?: string
  iconSizeClass?: string
}

/**
 * Single colored toggle: shows only the active mode.
 * Agent = green, Council = blue, Arena = yellow.
 * Click cycles Agent → Council → Arena → Agent.
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
  const tooltipLabel = `Work mode: ${activeMeta.label} (click to cycle)`

  return (
    <Tooltip delayDuration={350}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={tooltipLabel}
          onClick={() => setMode(currentDirectory, cycleWorkMode(mode))}
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-semibold transition-colors",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            activeMeta.buttonClass,
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
