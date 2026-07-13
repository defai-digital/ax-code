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
import { useDirectoryStore } from "@/stores/useDirectoryStore"
import { useWorkModeStore } from "@/stores/useWorkModeStore"
import { WORK_MODES, type WorkModeId } from "@/lib/workMode"
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
    hint: "Multi-provider advisory review (consensus / majority / singleton)",
  },
  {
    value: "arena",
    icon: "sparkling",
    label: "Arena",
    hint: "Multi-model best-of-N (enable modes.arena in config if needed)",
  },
]

interface WorkModeSelectorProps {
  className?: string
  iconSizeClass?: string
}

export const WorkModeSelector: React.FC<WorkModeSelectorProps> = ({
  className,
  iconSizeClass = "h-[18px] w-[18px]",
}) => {
  const currentDirectory = useDirectoryStore((s) => s.currentDirectory)
  const mode = useWorkModeStore((s) => s.getMode(currentDirectory))
  const setMode = useWorkModeStore((s) => s.setMode)

  const activeMeta = MODES.find((m) => m.value === mode) ?? MODES[0]!
  const title = "Work mode"
  const tooltipLabel = `${title}: ${activeMeta.label}`

  return (
    <DropdownMenu>
      <Tooltip delayDuration={400}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground",
              "hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              className,
            )}
            aria-label={tooltipLabel}
          >
            <Icon name={activeMeta.icon} className={iconSizeClass} />
            <span className="hidden sm:inline max-w-[4.5rem] truncate font-medium">{activeMeta.label}</span>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">{tooltipLabel}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>{title}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={mode}
          onValueChange={(value) => setMode(currentDirectory, value as WorkModeId)}
        >
          {MODES.map((m) => (
            <DropdownMenuRadioItem key={m.value} value={m.value} className="flex flex-col items-start gap-0.5 py-2">
              <span className="flex items-center gap-2 font-medium">
                <Icon name={m.icon} className="h-3.5 w-3.5" />
                {m.label}
                {m.value === "agent" ? (
                  <span className="text-[10px] font-normal text-muted-foreground">default</span>
                ) : null}
              </span>
              <span className="pl-5 text-[11px] text-muted-foreground leading-snug">{m.hint}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <p className="px-2 pb-2 pt-1 text-[10px] text-muted-foreground leading-snug">
          Free-text messages run as Agent, Council, or Arena. Explicit{" "}
          <code className="text-[10px]">/commands</code> are unchanged.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

void WORK_MODES