import React from "react"
import { cn } from "@/lib/utils"
import { useI18n } from "@/lib/i18n"
import { useDesktopSurfaceStore } from "@/stores/useDesktopSurfaceStore"
import type { DesktopSurfaceId } from "@/lib/desktopSurface"
import { useUIStore } from "@/stores/useUIStore"

/**
 * Centered segmented control mirroring Codex's Chat/Work top-bar toggle.
 * Labels: Work | Code (Code = existing AX Code Desktop IDE agent).
 */
export const DesktopSurfaceToggle: React.FC<{ className?: string }> = ({ className }) => {
  const { t } = useI18n()
  const surface = useDesktopSurfaceStore((state) => state.surface)
  const setSurface = useDesktopSurfaceStore((state) => state.setSurface)

  const select = React.useCallback(
    (next: DesktopSurfaceId) => {
      if (next === surface) return
      setSurface(next)
      // Work is chat-first; leave secondary IDE tabs when entering Work.
      if (next === "work") {
        const ui = useUIStore.getState()
        if (ui.activeMainTab !== "chat") {
          ui.setActiveMainTab("chat")
        }
        if (ui.splitPaneEnabled) {
          ui.toggleSplitPane()
        }
      }
    },
    [setSurface, surface],
  )

  const options: Array<{ id: DesktopSurfaceId; label: string }> = [
    { id: "work", label: t("header.surface.work") },
    { id: "code", label: t("header.surface.code") },
  ]

  return (
    <div
      role="tablist"
      aria-label={t("header.surface.aria")}
      className={cn(
        "app-region-no-drag inline-flex h-8 items-center rounded-full border border-border/60 bg-muted/50 p-0.5",
        className,
      )}
    >
      {options.map((option) => {
        const selected = surface === option.id
        return (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => select(option.id)}
            className={cn(
              "min-w-[4.25rem] rounded-full px-3 py-1 typography-ui-label font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--interactive-focus-ring)]",
              selected
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
