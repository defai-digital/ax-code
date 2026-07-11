import React from "react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Icon } from "@/components/icon/Icon"
import type { IconName } from "@/components/icon/icons"
import { useThemeSystem } from "@/contexts/useThemeSystem"
import { useI18n, type I18nKey } from "@/lib/i18n"
import type { ThemeMode } from "@/types/theme"
import { cn } from "@/lib/utils"

const MODE_OPTIONS: Array<{ value: ThemeMode; icon: IconName; labelKey: I18nKey }> = [
  {
    value: "system",
    icon: "computer",
    labelKey: "settings.openchamber.visual.option.themeMode.system",
  },
  {
    value: "light",
    icon: "lightbulb",
    labelKey: "settings.openchamber.visual.option.themeMode.light",
  },
  {
    value: "dark",
    icon: "palette",
    labelKey: "settings.openchamber.visual.option.themeMode.dark",
  },
]

type ThemeModeToggleProps = {
  className?: string
  /** Match sidebar footer icon button sizing. */
  buttonClassName?: string
}

/**
 * Discoverable Light / Dark / System theme control for app chrome.
 * Full theme pack selection remains in Settings → Appearance.
 */
export function ThemeModeToggle({ className, buttonClassName }: ThemeModeToggleProps): React.ReactNode {
  const { t } = useI18n()
  const { themeMode, setThemeMode, currentTheme } = useThemeSystem()
  const [menuOpen, setMenuOpen] = React.useState(false)

  const activeOption = MODE_OPTIONS.find((option) => option.value === themeMode) ?? MODE_OPTIONS[0]
  const resolvedVariant = currentTheme.metadata.variant
  const tooltipLabel = t("sessions.sidebar.footer.actions.themeMode", {
    mode: t(activeOption.labelKey),
  })

  // When matching system, show an icon that reflects the effective palette.
  const triggerIcon: IconName =
    themeMode === "system" ? "computer" : resolvedVariant === "dark" ? "palette" : "lightbulb"

  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(buttonClassName, className)}
              aria-label={tooltipLabel}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <Icon name={triggerIcon} className="h-4.5 w-4.5" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={4}>
          <p>{tooltipLabel}</p>
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" side="top" className="min-w-[11rem]">
        <DropdownMenuLabel className="typography-meta text-muted-foreground">
          {t("sessions.sidebar.footer.themeMode.menuTitle")}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={themeMode}
          onValueChange={(value) => {
            if (value === "system" || value === "light" || value === "dark") {
              setThemeMode(value)
            }
          }}
        >
          {MODE_OPTIONS.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value} className="gap-2">
              <Icon name={option.icon} className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span>{t(option.labelKey)}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
