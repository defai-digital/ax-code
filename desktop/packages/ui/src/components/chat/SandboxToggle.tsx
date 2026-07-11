import React from "react"
import { Icon } from "@/components/icon/Icon"
import { cn } from "@/lib/utils"
import { useI18n } from "@/lib/i18n"
import { useDirectoryStore } from "@/stores/useDirectoryStore"
import { useSandboxStore } from "@/stores/useSandboxStore"
import { normalizeDirectoryKey } from "@/stores/utils/directoryKey"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

interface SandboxToggleProps {
  className?: string
  iconSizeClass?: string
  /** When true, wraps the control in a tooltip (composer footer). */
  withTooltip?: boolean
}

export const SandboxToggle: React.FC<SandboxToggleProps> = ({
  className,
  iconSizeClass = "h-[18px] w-[18px]",
  withTooltip = true,
}) => {
  const { t } = useI18n()
  const currentDirectory = useDirectoryStore((s) => s.currentDirectory)
  // Must match the key the store writes under (normalizeDirectoryKey), not a
  // plain trim — otherwise unnormalized paths (trailing slash, backslashes)
  // subscribe to a key the store never populates.
  const dirKey = normalizeDirectoryKey(currentDirectory)

  const sandbox = useSandboxStore((s) => s.sandboxByDirectory[dirKey])
  const pending = useSandboxStore((s) => s.pendingByDirectory[dirKey] === true)
  const loadSandbox = useSandboxStore((s) => s.loadSandbox)
  const setSandbox = useSandboxStore((s) => s.setSandbox)

  React.useEffect(() => {
    void loadSandbox(currentDirectory)
  }, [currentDirectory, loadSandbox])

  const isOn = sandbox === true
  const label = isOn ? t("chat.chatInput.sandbox.on") : t("chat.chatInput.sandbox.off")
  const disabled = pending || sandbox === undefined

  const button = (
    <button
      type="button"
      aria-label={label}
      title={withTooltip ? undefined : label}
      aria-pressed={isOn}
      disabled={disabled}
      onClick={() => {
        if (disabled) return
        void setSandbox(currentDirectory, !isOn)
      }}
      onMouseDown={(event) => {
        event.preventDefault()
      }}
      className={cn(
        "flex h-7 w-7 flex-shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none transition-colors",
        "hover:bg-interactive-hover hover:text-foreground",
        "focus-visible:ring-2 focus-visible:ring-[var(--interactive-focus-ring)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        isOn && "bg-interactive-selection text-[var(--status-info)] hover:text-[var(--status-info)]",
        className,
      )}
    >
      <Icon
        name={pending ? "loader-4" : isOn ? "shield-check" : "lock-unlock"}
        className={cn(iconSizeClass, "flex-shrink-0", pending && "animate-spin")}
      />
    </button>
  )

  if (!withTooltip) {
    return button
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="top" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}
