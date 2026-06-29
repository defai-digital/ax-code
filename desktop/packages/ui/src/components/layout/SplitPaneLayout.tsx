import React from "react"
import { cn } from "@/lib/utils"
import { useSplitPane, type SplitPaneRightTab } from "@/hooks/useSplitPane"
import { Icon } from "@/components/icon/Icon"
import { useI18n } from "@/lib/i18n"
import { useUIStore } from "@/stores/useUIStore"
import type { IconName } from "@/components/icon/icons"

const SPLIT_TAB_OPTIONS: { value: SplitPaneRightTab; icon: IconName; labelKey: string }[] = [
  { value: "files", icon: "folder-3", labelKey: "splitPane.tab.files" },
  { value: "diff", icon: "git-commit", labelKey: "splitPane.tab.diff" },
  { value: "git", icon: "git-branch", labelKey: "splitPane.tab.git" },
  { value: "terminal", icon: "terminal-box", labelKey: "splitPane.tab.terminal" },
  { value: "plan", icon: "list-check-2", labelKey: "splitPane.tab.plan" },
  { value: "context", icon: "layout-column", labelKey: "splitPane.tab.context" },
]

const HANDLE_WIDTH = 4

interface SplitPaneLayoutProps {
  children: React.ReactNode
  rightContent: React.ReactNode
}

export const SplitPaneLayout: React.FC<SplitPaneLayoutProps> = ({ children, rightContent }) => {
  const { t } = useI18n()
  const { splitEnabled, splitRatio, splitRightTab, setSplitRatio, setSplitRightTab } = useSplitPane()
  const [isDragging, setIsDragging] = React.useState(false)
  const containerRef = React.useRef<HTMLDivElement>(null)
  const startXRef = React.useRef(0)
  const startRatioRef = React.useRef(splitRatio)

  const handlePointerDown = React.useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
      setIsDragging(true)
      startXRef.current = e.clientX
      startRatioRef.current = useUIStore.getState().splitPaneRatio
    },
    [],
  )

  const handlePointerMove = React.useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging || !containerRef.current) return
      const containerWidth = containerRef.current.getBoundingClientRect().width
      if (containerWidth === 0) return
      const delta = e.clientX - startXRef.current
      const ratioDelta = delta / containerWidth
      setSplitRatio(startRatioRef.current + ratioDelta)
    },
    [isDragging, setSplitRatio],
  )

  const handlePointerUp = React.useCallback(
    (e: React.PointerEvent) => {
      try {
        ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      setIsDragging(false)
    },
    [],
  )

  if (!splitEnabled) {
    return <>{children}</>
  }

  const leftPercent = `${splitRatio * 100}%`
  const rightPercent = `${(1 - splitRatio) * 100}%`

  return (
    <div ref={containerRef} className="flex h-full w-full overflow-hidden">
      {/* Left pane */}
      <div className="relative h-full min-w-0 overflow-hidden" style={{ width: leftPercent }}>
        {children}
      </div>

      {/* Drag handle */}
      <div
        className={cn(
          "relative flex-shrink-0 cursor-col-resize bg-border/40 transition-colors",
          "hover:bg-[var(--interactive-border)]",
          isDragging && "bg-[var(--interactive-border)]",
        )}
        style={{ width: HANDLE_WIDTH }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        role="separator"
        aria-orientation="vertical"
        aria-label={t("splitPane.resizeAria")}
      />

      {/* Right pane */}
      <div className="relative h-full min-w-0 overflow-hidden" style={{ width: rightPercent }}>
        {/* Tab bar for right pane */}
        <div className="flex h-8 items-center gap-0.5 border-b border-border/40 bg-[var(--surface-background)] px-1">
          {SPLIT_TAB_OPTIONS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setSplitRightTab(tab.value)}
              className={cn(
                "inline-flex h-6 items-center gap-1 rounded px-2 text-[11px] transition-colors",
                splitRightTab === tab.value
                  ? "bg-[var(--interactive-hover)] text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-[var(--interactive-hover)]/50",
              )}
              title={t(tab.labelKey as Parameters<typeof t>[0])}
            >
              <Icon name={tab.icon} className="h-3 w-3" />
              <span className="hidden sm:inline">{t(tab.labelKey as Parameters<typeof t>[0])}</span>
            </button>
          ))}
        </div>
        <div className="absolute inset-0 top-8 overflow-hidden">{rightContent}</div>
      </div>
    </div>
  )
}
