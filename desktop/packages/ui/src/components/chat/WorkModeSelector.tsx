import React from "react"
import { Icon } from "@/components/icon/Icon"
import type { IconName } from "@/components/icon/icons"
import { cn } from "@/lib/utils"
import { useDirectoryStore } from "@/stores/useDirectoryStore"
import { useWorkModeStore } from "@/stores/useWorkModeStore"
import { normalizeDirectoryKey } from "@/stores/utils/directoryKey"
import { DEFAULT_WORK_MODE, parseWorkMode, WORK_MODES, type WorkModeId } from "@/lib/workMode"
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
    hint: "Normal single-agent coding (default)",
  },
  {
    value: "council",
    icon: "scales-3",
    label: "Council",
    hint: "Multi-provider advisory review",
  },
  {
    value: "arena",
    icon: "sparkling",
    label: "Arena",
    hint: "Multi-model best-of-N comparison",
  },
]

interface WorkModeSelectorProps {
  className?: string
  iconSizeClass?: string
}

/**
 * Qoder-style segmented control: Agent | Council | Arena.
 * Free-text send is remapped by session-ui-store; default is Agent.
 */
export const WorkModeSelector: React.FC<WorkModeSelectorProps> = ({
  className,
  iconSizeClass = "h-3.5 w-3.5",
}) => {
  const currentDirectory = useDirectoryStore((s) => s.currentDirectory)
  const dirKey = normalizeDirectoryKey(currentDirectory)
  // Subscribe to the raw map entry so UI updates immediately on setMode.
  const mode = useWorkModeStore((s) => parseWorkMode(s.modeByDirectory[dirKey], DEFAULT_WORK_MODE))
  const setMode = useWorkModeStore((s) => s.setMode)

  return (
    <div
      role="radiogroup"
      aria-label="Work mode"
      className={cn(
        "inline-flex items-center rounded-md border border-border/60 bg-muted/30 p-0.5",
        className,
      )}
    >
      {MODES.map((m) => {
        const selected = mode === m.value
        return (
          <Tooltip key={m.value} delayDuration={350}>
            <TooltipTrigger asChild>
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={m.label}
                onClick={() => setMode(currentDirectory, m.value)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-[6px] px-1.5 py-0.5 text-[11px] font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  selected
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon name={m.icon} className={iconSizeClass} />
                <span className="hidden sm:inline">{m.label}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[14rem] text-xs">
              <p className="font-medium">{m.label}</p>
              <p className="text-muted-foreground">{m.hint}</p>
            </TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}

void WORK_MODES
