import React from "react"
import { Header } from "./Header"
import { BottomTerminalDock } from "./BottomTerminalDock"
import { Sidebar, SIDEBAR_CONTENT_WIDTH } from "./Sidebar"
import { RightSidebar, RIGHT_SIDEBAR_CONTENT_WIDTH } from "./RightSidebar"
import { ProjectContextPanel, RightSidebarTabs } from "./RightSidebarTabs"
import { ContextPanel } from "./ContextPanel"
import { SplitPaneLayout } from "./SplitPaneLayout"
import { ErrorBoundary } from "../ui/ErrorBoundary"
import { CommandPalette } from "../ui/CommandPalette"
import { HelpDialog } from "../ui/HelpDialog"
import { AxCodeStatusDialog } from "../ui/AxCodeStatusDialog"
import { SessionSidebar } from "@/components/session/SessionSidebar"
import { SessionDialogs } from "@/components/session/SessionDialogs"
import { DiffWorkerProvider } from "@/contexts/DiffWorkerProvider"

import { useUIStore } from "@/stores/useUIStore"
import { useUpdateStore } from "@/stores/useUpdateStore"
import { useDeviceInfo } from "@/lib/device"
import { isDesktopLocalOriginActive } from "@/lib/desktop"
import { useI18n } from "@/lib/i18n"
import { Icon } from "@/components/icon/Icon"
import { cn } from "@/lib/utils"
import { lazyWithChunkRecovery } from "@/lib/chunkLoadRecovery"

import { ChatView } from "@/components/views/ChatView"

const TerminalView = lazyWithChunkRecovery(() =>
  import("@/components/views/TerminalView").then((m) => ({ default: m.TerminalView })),
)
const SettingsWindow = lazyWithChunkRecovery(() =>
  import("@/components/views/SettingsWindow").then((m) => ({ default: m.SettingsWindow })),
)
const MultiRunWindow = lazyWithChunkRecovery(() =>
  import("@/components/views/MultiRunWindow").then((m) => ({ default: m.MultiRunWindow })),
)
const DiffView = lazyWithChunkRecovery(() =>
  import("@/components/views/DiffView").then((m) => ({ default: m.DiffView })),
)
const FilesView = lazyWithChunkRecovery(() =>
  import("@/components/views/FilesView").then((m) => ({ default: m.FilesView })),
)
const GitView = lazyWithChunkRecovery(() => import("@/components/views/GitView").then((m) => ({ default: m.GitView })))
const PlanView = lazyWithChunkRecovery(() =>
  import("@/components/views/PlanView").then((m) => ({ default: m.PlanView })),
)

const DESKTOP_SIDEBAR_MIN_WIDTH = 280
const DESKTOP_SIDEBAR_MAX_WIDTH = 500
const DESKTOP_RIGHT_SIDEBAR_MIN_WIDTH = 360
const DESKTOP_RIGHT_SIDEBAR_MAX_WIDTH = 860
const SIDEBAR_CORNER_SIZE = 10

const sidebarCornerBackground = (position: string) =>
  `radial-gradient(circle at ${position}, transparent calc(${SIDEBAR_CORNER_SIZE}px - 1px), var(--sidebar) ${SIDEBAR_CORNER_SIZE}px)`

export const MainLayout: React.FC = () => {
  const { t } = useI18n()
  const RIGHT_SIDEBAR_AUTO_CLOSE_WIDTH = 1140
  const RIGHT_SIDEBAR_AUTO_OPEN_WIDTH = 1220
  const BOTTOM_TERMINAL_AUTO_CLOSE_HEIGHT = 640
  const BOTTOM_TERMINAL_AUTO_OPEN_HEIGHT = 700
  const LEFT_SIDEBAR_AUTO_CLOSE_WIDTH = 900
  const LEFT_SIDEBAR_AUTO_OPEN_WIDTH = 980
  const isSidebarOpen = useUIStore((state) => state.isSidebarOpen)
  const isRightSidebarOpen = useUIStore((state) => state.isRightSidebarOpen)
  const isBottomTerminalOpen = useUIStore((state) => state.isBottomTerminalOpen)
  const setSidebarOpen = useUIStore((state) => state.setSidebarOpen)
  const setRightSidebarOpen = useUIStore((state) => state.setRightSidebarOpen)
  const setBottomTerminalOpen = useUIStore((state) => state.setBottomTerminalOpen)
  const activeMainTab = useUIStore((state) => state.activeMainTab)
  const setActiveMainTab = useUIStore((state) => state.setActiveMainTab)
  const splitPaneEnabled = useUIStore((state) => state.splitPaneEnabled)
  const splitPaneRightTab = useUIStore((state) => state.splitPaneRightTab)
  const setIsMobile = useUIStore((state) => state.setIsMobile)
  const isSettingsDialogOpen = useUIStore((state) => state.isSettingsDialogOpen)
  const setSettingsDialogOpen = useUIStore((state) => state.setSettingsDialogOpen)
  const isMultiRunLauncherOpen = useUIStore((state) => state.isMultiRunLauncherOpen)
  const setMultiRunLauncherOpen = useUIStore((state) => state.setMultiRunLauncherOpen)
  const multiRunLauncherPrefillPrompt = useUIStore((state) => state.multiRunLauncherPrefillPrompt)
  const { isMobile, isTablet } = useDeviceInfo()
  const sidebarWidth = useUIStore((state) => state.sidebarWidth)
  const rightSidebarWidth = useUIStore((state) => state.rightSidebarWidth)
  const rightSidebarAutoClosedRef = React.useRef(false)
  const bottomTerminalAutoClosedRef = React.useRef(false)
  const leftSidebarAutoClosedRef = React.useRef(false)

  // Trigger native desktop update checks shortly after mount, then repeat periodically.
  const checkForUpdates = useUpdateStore((state) => state.checkForUpdates)
  React.useEffect(() => {
    if (!isDesktopLocalOriginActive()) {
      return
    }

    const initialDelayMs = 3000
    const defaultIntervalMs = 60 * 60 * 1000
    const minIntervalMs = 5 * 60 * 1000
    const maxIntervalMs = 24 * 60 * 60 * 1000
    let disposed = false
    let timer: number | null = null

    const clampIntervalMs = (seconds: number): number => {
      const ms = Math.round(seconds * 1000)
      return Math.max(minIntervalMs, Math.min(maxIntervalMs, ms))
    }

    const scheduleNext = (delayMs: number) => {
      if (disposed) return
      timer = window.setTimeout(async () => {
        const suggestedSec = await checkForUpdates()
        const nextDelay =
          typeof suggestedSec === "number" && Number.isFinite(suggestedSec)
            ? clampIntervalMs(suggestedSec)
            : defaultIntervalMs
        scheduleNext(nextDelay)
      }, delayMs)
    }

    scheduleNext(initialDelayMs)

    return () => {
      disposed = true
      if (timer !== null) {
        window.clearTimeout(timer)
      }
    }
  }, [checkForUpdates])

  React.useEffect(() => {
    const previous = useUIStore.getState().isMobile
    if (previous !== isMobile) {
      setIsMobile(isMobile)
    }
  }, [isMobile, setIsMobile])

  React.useEffect(() => {
    if (typeof window === "undefined") {
      return
    }

    let timeoutId: number | undefined

    const handleResize = () => {
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId)
      }

      timeoutId = window.setTimeout(() => {
        useUIStore.getState().updateProportionalSidebarWidths()
      }, 150)
    }

    window.addEventListener("resize", handleResize)

    return () => {
      window.removeEventListener("resize", handleResize)
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [])

  React.useEffect(() => {
    if (typeof window === "undefined") {
      return
    }

    let timeoutId: number | undefined

    const handleResponsivePanels = () => {
      const state = useUIStore.getState()
      const width = window.innerWidth
      const height = window.innerHeight

      // Touch devices frequently resize when the on-screen keyboard opens.
      // Treat panel auto-collapse/restore as desktop-only so keyboard
      // viewport changes do not churn drawer or terminal layout state.
      if (!isMobile && !isTablet) {
        const shouldCloseLeftSidebar = width < LEFT_SIDEBAR_AUTO_CLOSE_WIDTH
        const canAutoOpenLeftSidebar = width >= LEFT_SIDEBAR_AUTO_OPEN_WIDTH

        if (shouldCloseLeftSidebar) {
          if (state.isSidebarOpen) {
            setSidebarOpen(false)
            leftSidebarAutoClosedRef.current = true
          }
        } else if (canAutoOpenLeftSidebar && leftSidebarAutoClosedRef.current) {
          setSidebarOpen(true)
          leftSidebarAutoClosedRef.current = false
        }

        const shouldCloseRightSidebar = width < RIGHT_SIDEBAR_AUTO_CLOSE_WIDTH
        const canAutoOpenRightSidebar = width >= RIGHT_SIDEBAR_AUTO_OPEN_WIDTH

        if (shouldCloseRightSidebar) {
          if (state.isRightSidebarOpen) {
            setRightSidebarOpen(false)
            rightSidebarAutoClosedRef.current = true
          }
        } else if (canAutoOpenRightSidebar && rightSidebarAutoClosedRef.current) {
          setRightSidebarOpen(true)
          rightSidebarAutoClosedRef.current = false
        }

        const shouldCloseBottomTerminal = height < BOTTOM_TERMINAL_AUTO_CLOSE_HEIGHT
        const canAutoOpenBottomTerminal = height >= BOTTOM_TERMINAL_AUTO_OPEN_HEIGHT

        if (shouldCloseBottomTerminal) {
          if (state.isBottomTerminalOpen) {
            setBottomTerminalOpen(false)
            bottomTerminalAutoClosedRef.current = true
          }
        } else if (canAutoOpenBottomTerminal && bottomTerminalAutoClosedRef.current) {
          setBottomTerminalOpen(true)
          bottomTerminalAutoClosedRef.current = false
        }
      }
    }

    const handleResize = () => {
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId)
      }

      timeoutId = window.setTimeout(() => {
        handleResponsivePanels()
      }, 100)
    }

    handleResponsivePanels()
    window.addEventListener("resize", handleResize)

    return () => {
      window.removeEventListener("resize", handleResize)
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [isMobile, isTablet, setBottomTerminalOpen, setRightSidebarOpen, setSidebarOpen])

  React.useEffect(() => {
    if (typeof window === "undefined") {
      return
    }

    const unsubscribe = useUIStore.subscribe((state, prevState) => {
      const width = window.innerWidth
      const height = window.innerHeight

      const leftCanAutoOpen = width >= LEFT_SIDEBAR_AUTO_OPEN_WIDTH
      const rightCanAutoOpen = width >= RIGHT_SIDEBAR_AUTO_OPEN_WIDTH
      const bottomCanAutoOpen = height >= BOTTOM_TERMINAL_AUTO_OPEN_HEIGHT

      if (state.isSidebarOpen !== prevState.isSidebarOpen && leftCanAutoOpen) {
        leftSidebarAutoClosedRef.current = false
      }

      if (state.isRightSidebarOpen !== prevState.isRightSidebarOpen && rightCanAutoOpen) {
        rightSidebarAutoClosedRef.current = false
      }

      if (state.isBottomTerminalOpen !== prevState.isBottomTerminalOpen && bottomCanAutoOpen) {
        bottomTerminalAutoClosedRef.current = false
      }
    })

    return () => {
      unsubscribe()
    }
  }, [isMobile, isTablet, setBottomTerminalOpen, setRightSidebarOpen, setSidebarOpen])

  const splitRightContent = React.useMemo(() => {
    if (!splitPaneEnabled) return null
    switch (splitPaneRightTab) {
      case "files":
        return (
          <React.Suspense fallback={null}>
            <FilesView />
          </React.Suspense>
        )
      case "diff":
        return (
          <React.Suspense fallback={null}>
            <DiffView />
          </React.Suspense>
        )
      case "git":
        return (
          <React.Suspense fallback={null}>
            <GitView />
          </React.Suspense>
        )
      case "terminal":
        return (
          <React.Suspense fallback={null}>
            <TerminalView />
          </React.Suspense>
        )
      case "plan":
        return (
          <React.Suspense fallback={null}>
            <PlanView />
          </React.Suspense>
        )
      case "context":
        return (
          <React.Suspense fallback={null}>
            <ProjectContextPanel />
          </React.Suspense>
        )
      default:
        return null
    }
  }, [splitPaneEnabled, splitPaneRightTab])

  const secondaryView = React.useMemo(() => {
    switch (activeMainTab) {
      case "plan":
        return (
          <React.Suspense fallback={null}>
            <PlanView />
          </React.Suspense>
        )
      case "git":
        return (
          <React.Suspense fallback={null}>
            <GitView />
          </React.Suspense>
        )
      case "diff":
        return (
          <React.Suspense fallback={null}>
            <DiffView />
          </React.Suspense>
        )
      case "terminal":
        return (
          <React.Suspense fallback={null}>
            <TerminalView />
          </React.Suspense>
        )
      case "files":
        return (
          <React.Suspense fallback={null}>
            <FilesView />
          </React.Suspense>
        )
      case "context":
        return (
          <React.Suspense fallback={null}>
            <ProjectContextPanel />
          </React.Suspense>
        )
      default:
        return null
    }
  }, [activeMainTab])

  const isChatActive = activeMainTab === "chat"
  const visibleSidebarWidth = React.useMemo(() => {
    const rawWidth = sidebarWidth || SIDEBAR_CONTENT_WIDTH
    return Math.min(DESKTOP_SIDEBAR_MAX_WIDTH, Math.max(DESKTOP_SIDEBAR_MIN_WIDTH, rawWidth))
  }, [sidebarWidth])
  const visibleRightSidebarWidth = React.useMemo(() => {
    const rawWidth = rightSidebarWidth || RIGHT_SIDEBAR_CONTENT_WIDTH
    return Math.min(DESKTOP_RIGHT_SIDEBAR_MAX_WIDTH, Math.max(DESKTOP_RIGHT_SIDEBAR_MIN_WIDTH, rawWidth))
  }, [rightSidebarWidth])

  return (
    <DiffWorkerProvider>
      <div data-page-scroll-lock="true" className={cn("flex h-[100dvh]", "bg-background")}>
        <CommandPalette />
        <HelpDialog />
        <AxCodeStatusDialog />
        <SessionDialogs />

        {/* Desktop: full-width Header above [Sidebar | chat-frame | RightSidebar] row */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <Header />
          <div className="relative flex flex-1 min-h-0 overflow-hidden bg-sidebar" data-page-scroll-lock="true">
            <div
              aria-hidden
              className="pointer-events-none absolute top-0 z-0 bg-sidebar transition-[left,opacity] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
              style={{
                left: `${isSidebarOpen ? visibleSidebarWidth : 0}px`,
                opacity: isSidebarOpen ? 1 : 0,
                width: "10px",
                height: "10px",
                background: sidebarCornerBackground("100% 100%"),
              }}
            />
            <div
              aria-hidden
              className="pointer-events-none absolute bottom-0 z-0 bg-sidebar transition-[left,opacity] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
              style={{
                left: `${isSidebarOpen ? visibleSidebarWidth : 0}px`,
                opacity: isSidebarOpen ? 1 : 0,
                width: "10px",
                height: "10px",
                background: sidebarCornerBackground("100% 0%"),
              }}
            />
            <div
              aria-hidden
              className="pointer-events-none absolute top-0 z-0 bg-sidebar transition-[right,opacity] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
              style={{
                right: `${isRightSidebarOpen ? visibleRightSidebarWidth : 0}px`,
                opacity: isRightSidebarOpen ? 1 : 0,
                width: "10px",
                height: "10px",
                background: sidebarCornerBackground("0 100%"),
              }}
            />
            <div
              aria-hidden
              className="pointer-events-none absolute bottom-0 z-0 bg-sidebar transition-[right,opacity] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
              style={{
                right: `${isRightSidebarOpen ? visibleRightSidebarWidth : 0}px`,
                opacity: isRightSidebarOpen ? 1 : 0,
                width: "10px",
                height: "10px",
                background: sidebarCornerBackground("0 0"),
              }}
            />
            <Sidebar isOpen={isSidebarOpen} isMobile={isMobile} className="border-0">
              <SessionSidebar />
            </Sidebar>
            <div
              className={cn(
                "relative flex flex-1 min-w-0 flex-col overflow-hidden",
                "bg-background",
                "border border-border/50 rounded-[10px]",
                !isSidebarOpen && "border-l-transparent",
                !isRightSidebarOpen && "border-r-transparent",
              )}
              data-page-scroll-lock="true"
            >
              <SplitPaneLayout rightContent={splitRightContent}>
                <div className="flex flex-1 min-h-0 overflow-hidden" data-page-scroll-lock="true">
                  <div className="relative flex flex-1 min-h-0 min-w-0 overflow-hidden" data-page-scroll-lock="true">
                    <main className="flex-1 overflow-hidden bg-background relative" data-page-scroll-lock="true">
                      <div className={cn("absolute inset-0", !isChatActive && "invisible")}>
                        <ErrorBoundary>
                          <ChatView />
                        </ErrorBoundary>
                      </div>
                      {secondaryView && (
                        <div className="absolute inset-0 flex flex-col">
                          <div className="flex h-8 flex-shrink-0 items-center border-b border-border/40 bg-sidebar px-2">
                            <button
                              type="button"
                              onClick={() => setActiveMainTab("chat")}
                              aria-label={t("layout.backToChat")}
                              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 typography-meta text-muted-foreground transition-colors hover:bg-interactive-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--interactive-focus-ring)]"
                            >
                              <Icon name="arrow-left" className="h-3.5 w-3.5" aria-hidden="true" />
                              {t("layout.backToChat")}
                            </button>
                          </div>
                          <div className="relative min-h-0 flex-1">
                            <ErrorBoundary>{secondaryView}</ErrorBoundary>
                          </div>
                        </div>
                      )}
                    </main>
                    <ContextPanel />
                  </div>
                </div>
              </SplitPaneLayout>
              <BottomTerminalDock isOpen={isBottomTerminalOpen} isMobile={isMobile}>
                {isBottomTerminalOpen ? (
                  <ErrorBoundary>
                    <React.Suspense fallback={null}>
                      <TerminalView />
                    </React.Suspense>
                  </ErrorBoundary>
                ) : null}
              </BottomTerminalDock>
            </div>
            <RightSidebar isOpen={isRightSidebarOpen} className="border-0">
              <ErrorBoundary>
                <RightSidebarTabs />
              </ErrorBoundary>
            </RightSidebar>
          </div>
        </div>

        {/* Desktop settings: windowed dialog with blur */}
        <React.Suspense fallback={null}>
          <SettingsWindow open={isSettingsDialogOpen} onOpenChange={setSettingsDialogOpen} />
        </React.Suspense>
        <React.Suspense fallback={null}>
          <MultiRunWindow
            open={isMultiRunLauncherOpen}
            onOpenChange={setMultiRunLauncherOpen}
            initialPrompt={multiRunLauncherPrefillPrompt}
          />
        </React.Suspense>
      </div>
    </DiffWorkerProvider>
  )
}
