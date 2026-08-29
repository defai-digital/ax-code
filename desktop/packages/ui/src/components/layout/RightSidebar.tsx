import React from "react"
import { cn } from "@/lib/utils"
import { useUIStore } from "@/stores/useUIStore"
import { useI18n } from "@/lib/i18n"
import { useSidebarResize } from "@/hooks/useSidebarResize"

export const RIGHT_SIDEBAR_CONTENT_WIDTH = 420
const RIGHT_SIDEBAR_MIN_WIDTH = 360
const RIGHT_SIDEBAR_MAX_WIDTH = 860

interface RightSidebarProps {
  isOpen: boolean
  children: React.ReactNode
  className?: string
}

export const RightSidebar: React.FC<RightSidebarProps> = ({ isOpen, children, className }) => {
  const { t } = useI18n()
  const rightSidebarWidth = useUIStore((state) => state.rightSidebarWidth)
  const setRightSidebarWidth = useUIStore((state) => state.setRightSidebarWidth)

  const {
    sidebarRef,
    isResizing,
    openWidth,
    appliedWidth,
    currentWidth,
    handlePointerDown,
    handlePointerMove,
    handlePointerEnd,
    handleResizeKeyDown,
  } = useSidebarResize({
    edge: "right",
    isOpen,
    width: rightSidebarWidth,
    setWidth: setRightSidebarWidth,
    defaultWidth: RIGHT_SIDEBAR_CONTENT_WIDTH,
    minWidth: RIGHT_SIDEBAR_MIN_WIDTH,
    maxWidth: RIGHT_SIDEBAR_MAX_WIDTH,
    cssVariable: "--oc-right-sidebar-width",
  })

  return (
    <aside
      ref={sidebarRef}
      className={cn(
        "relative flex h-full overflow-hidden border-l border-border/40 will-change-[width] motion-reduce:transition-none",
        "bg-sidebar",
        !isOpen && "border-l-0",
        className,
      )}
      style={{
        width: `${currentWidth}px`,
        minWidth: `${currentWidth}px`,
        maxWidth: `${currentWidth}px`,
        ["--oc-right-sidebar-width" as string]: `${isResizing ? currentWidth : openWidth}px`,
        overflowX: "clip",
        transitionProperty: isResizing ? "none" : "width, min-width, max-width",
        transitionDuration: "200ms",
        transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
      }}
      aria-hidden={!isOpen || appliedWidth === 0}
    >
      {isOpen && (
        <div
          className={cn(
            "absolute left-0 top-0 z-20 h-full w-[3px] cursor-col-resize hover:bg-[var(--interactive-border)]/80 transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--interactive-focus-ring)]",
            isResizing && "bg-[var(--interactive-border)]",
          )}
          tabIndex={0}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          onKeyDown={handleResizeKeyDown}
          role="separator"
          aria-orientation="vertical"
          aria-valuemin={RIGHT_SIDEBAR_MIN_WIDTH}
          aria-valuemax={RIGHT_SIDEBAR_MAX_WIDTH}
          aria-valuenow={openWidth}
          aria-label={t("sidebar.resize.rightPanelAria")}
        />
      )}
      <div
        className={cn(
          "relative z-10 flex h-full min-h-0 shrink-0 flex-col transition-opacity duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
          isResizing && "pointer-events-none",
          !isOpen && "pointer-events-none select-none opacity-0",
        )}
        style={{ width: "var(--oc-right-sidebar-width)" }}
        aria-hidden={!isOpen}
      >
        {isOpen ? children : null}
      </div>
    </aside>
  )
}
