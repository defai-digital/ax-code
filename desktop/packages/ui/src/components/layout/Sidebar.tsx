import React from "react"
import { cn } from "@/lib/utils"
import { ErrorBoundary } from "../ui/ErrorBoundary"
import { useI18n } from "@/lib/i18n"
import { useUIStore } from "@/stores/useUIStore"
import { useSidebarResize } from "@/hooks/useSidebarResize"

export const SIDEBAR_CONTENT_WIDTH = 280
const SIDEBAR_MIN_WIDTH = 280
const SIDEBAR_MAX_WIDTH = 500

interface SidebarProps {
  isOpen: boolean
  isMobile: boolean
  children: React.ReactNode
  className?: string
}

export const Sidebar: React.FC<SidebarProps> = ({ isOpen, isMobile, children, className }) => {
  const { t } = useI18n()
  const sidebarWidth = useUIStore((state) => state.sidebarWidth)
  const setSidebarWidth = useUIStore((state) => state.setSidebarWidth)

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
    edge: "left",
    isOpen,
    isMobile,
    width: sidebarWidth,
    setWidth: setSidebarWidth,
    defaultWidth: SIDEBAR_CONTENT_WIDTH,
    minWidth: SIDEBAR_MIN_WIDTH,
    maxWidth: SIDEBAR_MAX_WIDTH,
    cssVariable: "--oc-left-sidebar-width",
  })

  if (isMobile) {
    return null
  }

  return (
    <aside
      ref={sidebarRef}
      className={cn(
        "relative flex h-full overflow-hidden border-r border-border/40 will-change-[width] motion-reduce:transition-none",
        "bg-sidebar",
        !isOpen && "border-r-0",
        className,
      )}
      style={{
        width: `${currentWidth}px`,
        minWidth: `${currentWidth}px`,
        maxWidth: `${currentWidth}px`,
        ["--oc-left-sidebar-width" as string]: `${isResizing ? currentWidth : openWidth}px`,
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
            "absolute right-0 top-0 z-20 h-full w-[3px] cursor-col-resize hover:bg-[var(--interactive-border)]/80 transition-colors",
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
          aria-valuemin={SIDEBAR_MIN_WIDTH}
          aria-valuemax={SIDEBAR_MAX_WIDTH}
          aria-valuenow={openWidth}
          aria-label={t("sidebar.resize.leftPanelAria")}
        />
      )}
      <div
        className={cn(
          "relative z-10 flex h-full shrink-0 flex-col transition-opacity duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
          isResizing && "pointer-events-none",
          !isOpen && "pointer-events-none select-none opacity-0",
        )}
        style={{ width: "var(--oc-left-sidebar-width)", overflowX: "hidden" }}
        aria-hidden={!isOpen}
        inert={!isOpen || undefined}
      >
        <div className="flex-1 overflow-y-auto">
          <ErrorBoundary>{children}</ErrorBoundary>
        </div>
      </div>
    </aside>
  )
}
