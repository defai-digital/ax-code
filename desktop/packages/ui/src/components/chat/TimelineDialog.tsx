import React from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { toast } from "@/components/ui"
import { useSessionUIStore } from "@/sync/session-ui-store"
import { useSessionMessageRecords } from "@/sync/sync-context"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Icon } from "@/components/icon/Icon"
import type { Part, SessionRollbackPoint, SessionRollbackPreview } from "@ax-code/sdk/v2"
import { useI18n } from "@/lib/i18n"
import { useDeviceInfo } from "@/lib/device"
import { cn } from "@/lib/utils"
import { useSessionRollbackStore } from "@/stores/useSessionRollbackStore"
import { formatRollbackPointMeta } from "./TimelineDialog.helpers"

interface TimelineDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onScrollToMessage?: (messageId: string) => void | Promise<boolean>
  onScrollByTurnOffset?: (offset: number) => void
  onResumeToLatest?: () => void
}

export const TimelineDialog: React.FC<TimelineDialogProps> = ({
  open,
  onOpenChange,
  onScrollToMessage,
  onScrollByTurnOffset,
  onResumeToLatest,
}) => {
  const { t } = useI18n()
  const currentSessionId = useSessionUIStore((state) => state.currentSessionId)
  const currentSessionDirectory = useSessionUIStore((state) =>
    currentSessionId ? state.getDirectoryForSession(currentSessionId) : null,
  )
  const messages = useSessionMessageRecords(currentSessionId ?? "")
  const revertToMessage = useSessionUIStore((state) => state.revertToMessage)
  const forkFromMessage = useSessionUIStore((state) => state.forkFromMessage)
  const applyRollbackPoint = useSessionUIStore((state) => state.applyRollbackPoint)
  const rollbackPoints = useSessionRollbackStore((state) =>
    currentSessionId ? state.getPoints(currentSessionId, { directory: currentSessionDirectory }) : [],
  )
  const isLoadingRollbackPoints = useSessionRollbackStore((state) =>
    currentSessionId ? state.isLoading(currentSessionId, { directory: currentSessionDirectory }) : false,
  )
  const rollbackError = useSessionRollbackStore((state) =>
    currentSessionId ? state.getError(currentSessionId, { directory: currentSessionDirectory }) : null,
  )
  const refreshRollbackPoints = useSessionRollbackStore((state) => state.refreshPoints)
  const previewRollback = useSessionRollbackStore((state) => state.previewRollback)
  const { isMobile, isTablet } = useDeviceInfo()
  const alwaysShowActions = isMobile || isTablet

  const [forkingMessageId, setForkingMessageId] = React.useState<string | null>(null)
  const [rollbackPreview, setRollbackPreview] = React.useState<SessionRollbackPreview | null>(null)
  const [rollbackActionError, setRollbackActionError] = React.useState<string | null>(null)
  const [previewingRollbackStep, setPreviewingRollbackStep] = React.useState<number | null>(null)
  const [applyingRollbackStep, setApplyingRollbackStep] = React.useState<number | null>(null)
  const [searchQuery, setSearchQuery] = React.useState("")
  const [selectedIndex, setSelectedIndex] = React.useState(0)
  const itemRefs = React.useRef<(HTMLDivElement | null)[]>([])

  const formatRelativeTime = React.useCallback(
    (timestamp: number): string => {
      const now = Date.now()
      const diffMs = now - timestamp
      const diffSecs = Math.floor(diffMs / 1000)
      const diffMins = Math.floor(diffSecs / 60)
      const diffHours = Math.floor(diffMins / 60)
      const diffDays = Math.floor(diffHours / 24)

      if (diffSecs < 60) return t("chat.timeline.relative.justNow")
      if (diffMins < 60) return t("chat.timeline.relative.minutesAgo", { count: diffMins })
      if (diffHours < 24) return t("chat.timeline.relative.hoursAgo", { count: diffHours })
      if (diffDays < 7) return t("chat.timeline.relative.daysAgo", { count: diffDays })
      return new Date(timestamp).toLocaleDateString()
    },
    [t],
  )

  // Default list is user turns (timeline actions apply there). Search covers
  // every role so assistant/tool text is findable without leaving the chat.
  const userMessages = React.useMemo(() => {
    return messages
      .filter((message) => message.info.role === "user")
      .map((message, index) => ({
        message,
        messageNumber: index + 1,
        role: "user" as const,
      }))
      .reverse()
  }, [messages])

  const filteredMessages = React.useMemo(() => {
    const trimmedQuery = searchQuery.trim()
    if (!trimmedQuery) return userMessages

    const query = trimmedQuery.toLowerCase()
    return messages
      .map((message, index) => ({
        message,
        messageNumber: index + 1,
        role: message.info.role === "user" ? ("user" as const) : ("other" as const),
      }))
      .filter(({ message }) => getFullText(message.parts).toLowerCase().includes(query))
      .reverse()
  }, [messages, searchQuery, userMessages])

  React.useEffect(() => {
    setSelectedIndex(0)
  }, [filteredMessages])

  React.useEffect(() => {
    itemRefs.current = itemRefs.current.slice(0, filteredMessages.length)
  }, [filteredMessages.length])

  React.useEffect(() => {
    itemRefs.current[selectedIndex]?.scrollIntoView({
      block: "nearest",
    })
  }, [selectedIndex])

  React.useEffect(() => {
    if (!open || !currentSessionId) return
    void refreshRollbackPoints(currentSessionId, {
      directory: currentSessionDirectory,
      silent: rollbackPoints.length > 0,
    })
  }, [currentSessionDirectory, currentSessionId, open, refreshRollbackPoints, rollbackPoints.length])

  React.useEffect(() => {
    setRollbackPreview(null)
    setRollbackActionError(null)
    setPreviewingRollbackStep(null)
    setApplyingRollbackStep(null)
  }, [currentSessionId, open])

  const navigateToMessage = React.useCallback(
    async (messageId: string) => {
      const didNavigate = await onScrollToMessage?.(messageId)
      if (didNavigate === false) {
        return
      }
      onOpenChange(false)
    },
    [onOpenChange, onScrollToMessage],
  )

  const handleSearchKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      const total = filteredMessages.length
      if (total === 0) {
        return
      }

      if (event.key === "ArrowDown") {
        event.preventDefault()
        setSelectedIndex((current) => (current + 1) % total)
        return
      }

      if (event.key === "ArrowUp") {
        event.preventDefault()
        setSelectedIndex((current) => (current - 1 + total) % total)
        return
      }

      if (event.key === "Enter") {
        event.preventDefault()
        const safeIndex = ((selectedIndex % total) + total) % total
        const selected = filteredMessages[safeIndex]
        if (selected) {
          void navigateToMessage(selected.message.info.id)
        }
      }
    },
    [filteredMessages, navigateToMessage, selectedIndex],
  )

  // Handle fork with loading state and session refresh
  const handleFork = async (messageId: string) => {
    if (!currentSessionId) return
    setForkingMessageId(messageId)
    try {
      await forkFromMessage(currentSessionId, messageId)
      onOpenChange(false)
    } catch (error) {
      console.error("[TimelineDialog] Fork failed:", error)
      toast.error("Fork failed", {
        description: error instanceof Error ? error.message : "Please try again",
      })
    } finally {
      setForkingMessageId(null)
    }
  }

  const handlePreviewRollback = async (point: SessionRollbackPoint) => {
    if (!currentSessionId) return
    setRollbackActionError(null)
    setPreviewingRollbackStep(point.step)
    try {
      const preview = await previewRollback(
        currentSessionId,
        { step: point.step },
        { directory: currentSessionDirectory },
      )
      setRollbackPreview(preview)
    } catch (error) {
      const message = error instanceof Error ? error.message : t("chat.timeline.rollback.previewFailed")
      setRollbackActionError(message)
      toast.error(t("chat.timeline.rollback.previewFailed"), { description: message })
    } finally {
      setPreviewingRollbackStep(null)
    }
  }

  const handleApplyRollback = async (point: SessionRollbackPoint) => {
    if (!currentSessionId) return
    setRollbackActionError(null)
    setApplyingRollbackStep(point.step)
    try {
      await applyRollbackPoint(currentSessionId, { step: point.step })
      await refreshRollbackPoints(currentSessionId, { directory: currentSessionDirectory, silent: true })
      setRollbackPreview(null)
      onOpenChange(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : t("chat.timeline.rollback.applyFailed")
      setRollbackActionError(message)
      toast.error(t("chat.timeline.rollback.applyFailed"), { description: message })
    } finally {
      setApplyingRollbackStep(null)
    }
  }

  if (!currentSessionId) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[70vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon name="time" className="h-5 w-5" />
            {t("chat.timeline.title")}
          </DialogTitle>
          <DialogDescription>{t("chat.timeline.description")}</DialogDescription>
        </DialogHeader>

        <div className="relative mt-2">
          <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            autoFocus
            placeholder={t("chat.timeline.searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            className="pl-9 w-full"
          />
        </div>

        <RollbackPointsStrip
          points={rollbackPoints}
          isLoading={isLoadingRollbackPoints}
          error={rollbackError}
          onRefresh={() => refreshRollbackPoints(currentSessionId, { directory: currentSessionDirectory })}
          preview={rollbackPreview}
          actionError={rollbackActionError}
          previewingStep={previewingRollbackStep}
          applyingStep={applyingRollbackStep}
          onPreview={handlePreviewRollback}
          onApply={handleApplyRollback}
          t={t}
        />

        <div className="flex-1 overflow-y-auto">
          {filteredMessages.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              {searchQuery ? t("chat.timeline.empty.search") : t("chat.timeline.empty.session")}
            </div>
          ) : (
            filteredMessages.map(({ message, messageNumber, role }, index) => {
              const preview = getMessagePreview(message.parts)
              const timestamp = message.info.time.created
              const relativeTime = formatRelativeTime(timestamp)
              const isSelected = index === selectedIndex
              const isUserTurn = role === "user"
              const showTurnActions = isUserTurn && Boolean(currentSessionId)

              const snippet = searchQuery.trim() ? getSearchSnippet(getFullText(message.parts), searchQuery) : null
              const roleLabel =
                message.info.role === "user"
                  ? t("chat.timeline.role.user")
                  : message.info.role === "assistant"
                    ? t("chat.timeline.role.assistant")
                    : t("chat.timeline.role.other")

              return (
                <div
                  key={message.info.id}
                  ref={(element) => {
                    itemRefs.current[index] = element
                  }}
                  className={cn(
                    "group flex items-center gap-2 py-1.5 hover:bg-interactive-hover/30 rounded transition-colors cursor-pointer",
                    isSelected && "bg-interactive-selection text-interactive-selection-foreground",
                  )}
                  onClick={() => void navigateToMessage(message.info.id)}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <span
                    className={cn(
                      "typography-meta w-5 text-right flex-shrink-0",
                      isSelected ? "text-interactive-selection-foreground/70" : "text-muted-foreground",
                    )}
                  >
                    {messageNumber}.
                  </span>
                  {searchQuery.trim() ? (
                    <span
                      className={cn(
                        "typography-micro shrink-0 rounded px-1 py-0.5",
                        isSelected
                          ? "bg-interactive-selection-foreground/10 text-interactive-selection-foreground/80"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {roleLabel}
                    </span>
                  ) : null}
                  <p
                    className={cn(
                      "flex-1 min-w-0 typography-meta truncate ml-0.5",
                      isSelected ? "text-interactive-selection-foreground" : "text-foreground",
                    )}
                  >
                    {snippet ?? (preview || t("chat.timeline.noTextContent"))}
                    {!snippet && preview && preview.length >= 80 && "…"}
                  </p>

                  <div className="flex-shrink-0 h-5 flex items-center mr-2">
                    <span
                      className={cn(
                        "typography-meta whitespace-nowrap",
                        isSelected ? "text-interactive-selection-foreground/70" : "text-muted-foreground",
                        alwaysShowActions && showTurnActions ? "hidden" : "group-hover:hidden",
                      )}
                    >
                      {relativeTime}
                    </span>

                    {showTurnActions ? (
                      <div className={cn("gap-1", alwaysShowActions ? "flex" : "hidden group-hover:flex")}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              className="h-5 w-5 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                              onClick={async (e) => {
                                e.stopPropagation()
                                try {
                                  await revertToMessage(currentSessionId, message.info.id)
                                  onOpenChange(false)
                                } catch (error) {
                                  console.error("[TimelineDialog] Revert failed:", error)
                                  toast.error("Revert failed", {
                                    description: error instanceof Error ? error.message : "Please try again",
                                  })
                                }
                              }}
                            >
                              <Icon name="arrow-go-back" className="h-4 w-4" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent sideOffset={6}>{t("chat.timeline.actions.revertFromHere")}</TooltipContent>
                        </Tooltip>

                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              className="h-5 w-5 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleFork(message.info.id)
                              }}
                              disabled={forkingMessageId === message.info.id}
                            >
                              {forkingMessageId === message.info.id ? (
                                <Icon name="loader-4" className="h-4 w-4 animate-spin" />
                              ) : (
                                <Icon name="git-branch" className="h-4 w-4" />
                              )}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent sideOffset={6}>{t("chat.timeline.actions.forkFromHere")}</TooltipContent>
                        </Tooltip>
                      </div>
                    ) : null}
                  </div>
                </div>
              )
            })
          )}
        </div>

        <div className="mt-4 p-3 bg-muted/30 rounded-lg">
          <p className="typography-meta text-muted-foreground font-medium mb-2">{t("chat.timeline.actions.title")}</p>
          <div className="mb-2 flex items-center gap-2">
            <button
              type="button"
              className="text-[11px] uppercase tracking-wide text-muted-foreground/90 hover:text-foreground"
              onClick={() => {
                void onScrollByTurnOffset?.(-1)
                onOpenChange(false)
              }}
            >
              {t("chat.timeline.actions.previousTurn")}
            </button>
            <span className="text-muted-foreground">/</span>
            <button
              type="button"
              className="text-[11px] uppercase tracking-wide text-muted-foreground/90 hover:text-foreground"
              onClick={() => {
                onResumeToLatest?.()
                onOpenChange(false)
              }}
            >
              {t("chat.timeline.actions.latest")}
            </button>
          </div>
          <div className="flex flex-col gap-1.5 typography-meta text-muted-foreground">
            <div className="flex items-center gap-2">
              <span>{t("chat.timeline.help.clickMessage")}</span>
            </div>
            <div className="flex items-center gap-2">
              <Icon name="arrow-go-back" className="h-4 w-4 flex-shrink-0" />
              <span>{t("chat.timeline.help.undoToPoint")}</span>
            </div>
            <div className="flex items-center gap-2">
              <Icon name="git-branch" className="h-4 w-4 flex-shrink-0" />
              <span>{t("chat.timeline.help.createSessionFromHere")}</span>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

type TimelineTranslation = ReturnType<typeof useI18n>["t"]

function RollbackPointsStrip({
  points,
  isLoading,
  error,
  onRefresh,
  preview,
  actionError,
  previewingStep,
  applyingStep,
  onPreview,
  onApply,
  t,
}: {
  points: SessionRollbackPoint[]
  isLoading: boolean
  error: string | null
  onRefresh: () => Promise<unknown>
  preview: SessionRollbackPreview | null
  actionError: string | null
  previewingStep: number | null
  applyingStep: number | null
  onPreview: (point: SessionRollbackPoint) => Promise<void>
  onApply: (point: SessionRollbackPoint) => Promise<void>
  t: TimelineTranslation
}) {
  if (!isLoading && !error && points.length === 0) return null

  const visiblePoints = [...points].sort((a, b) => b.step - a.step).slice(0, 4)

  return (
    <section className="mt-3 rounded-md border border-border bg-muted/20 p-2">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Icon name="history" className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="typography-meta font-medium text-foreground">{t("chat.timeline.rollback.title")}</span>
            <span className="typography-meta text-muted-foreground">
              {t("chat.timeline.rollback.count", { count: points.length })}
            </span>
          </div>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-interactive-hover hover:text-foreground disabled:opacity-50"
              disabled={isLoading}
              onClick={(event) => {
                event.stopPropagation()
                void onRefresh()
              }}
              aria-label={t("chat.timeline.rollback.refresh")}
            >
              <Icon name="refresh" className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
            </button>
          </TooltipTrigger>
          <TooltipContent sideOffset={6}>{t("chat.timeline.rollback.refresh")}</TooltipContent>
        </Tooltip>
      </div>

      {error ? (
        <div className="typography-meta text-status-error">{error}</div>
      ) : visiblePoints.length === 0 ? (
        <div className="typography-meta text-muted-foreground">{t("chat.timeline.rollback.loading")}</div>
      ) : (
        <div className="grid gap-1.5">
          {visiblePoints.map((point) => {
            const isPreviewing = previewingStep === point.step
            const isApplying = applyingStep === point.step
            const isSelected = preview?.point.step === point.step
            return (
              <div
                key={`${point.messageID}:${point.partID}:${point.step}`}
                className="rounded bg-background/45 px-2 py-1"
              >
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <div className="min-w-0">
                    <span className="typography-meta flex-shrink-0 font-medium text-foreground">
                      {t("chat.timeline.rollback.step", { step: point.step })}
                    </span>
                    <span className="typography-meta ml-2 text-muted-foreground">{formatRollbackPointMeta(point)}</span>
                  </div>
                  <button
                    type="button"
                    className="inline-flex h-6 flex-shrink-0 items-center gap-1 rounded border border-border px-2 typography-meta text-muted-foreground transition-colors hover:bg-interactive-hover hover:text-foreground disabled:opacity-50"
                    disabled={Boolean(isPreviewing || isApplying)}
                    onClick={(event) => {
                      event.stopPropagation()
                      void onPreview(point)
                    }}
                  >
                    {isPreviewing ? (
                      <Icon name="loader-4" className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Icon name="eye" className="h-3.5 w-3.5" />
                    )}
                    {t(isSelected ? "chat.timeline.rollback.previewed" : "chat.timeline.rollback.preview")}
                  </button>
                </div>
                {isSelected ? (
                  <RollbackPreviewPanel
                    preview={preview}
                    isApplying={isApplying}
                    onApply={() => onApply(point)}
                    t={t}
                  />
                ) : null}
              </div>
            )
          })}
        </div>
      )}

      {actionError ? <div className="mt-2 typography-meta text-status-error">{actionError}</div> : null}
    </section>
  )
}

function RollbackPreviewPanel({
  preview,
  isApplying,
  onApply,
  t,
}: {
  preview: SessionRollbackPreview
  isApplying: boolean
  onApply: () => Promise<void>
  t: TimelineTranslation
}) {
  const files = preview.diffs.slice(0, 4)
  const hiddenCount = Math.max(0, preview.diffs.length - files.length)

  return (
    <div className="mt-2 rounded border border-border/70 bg-background/70 p-2">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 typography-meta text-muted-foreground">
        <span>{t("chat.timeline.rollback.previewSummary", preview.summary)}</span>
        <span className="text-status-success">+{preview.summary.additions}</span>
        <span className="text-status-error">-{preview.summary.deletions}</span>
      </div>

      {files.length === 0 ? (
        <div className="typography-meta text-muted-foreground">{t("chat.timeline.rollback.noFileChanges")}</div>
      ) : (
        <div className="grid gap-1">
          {files.map((diff) => (
            <div key={diff.file} className="flex min-w-0 items-center justify-between gap-2 typography-meta">
              <span className="min-w-0 truncate text-foreground">{diff.file}</span>
              <span className="flex-shrink-0 text-muted-foreground">
                <span className="text-status-success">+{diff.additions}</span>
                <span className="mx-1">/</span>
                <span className="text-status-error">-{diff.deletions}</span>
              </span>
            </div>
          ))}
          {hiddenCount > 0 ? (
            <div className="typography-meta text-muted-foreground">
              {t("chat.timeline.rollback.moreFiles", { count: hiddenCount })}
            </div>
          ) : null}
        </div>
      )}

      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="typography-meta text-muted-foreground">{t("chat.timeline.rollback.confirmation")}</p>
        <button
          type="button"
          className="inline-flex h-7 flex-shrink-0 items-center gap-1 rounded bg-status-error/10 px-2 typography-meta font-medium text-status-error transition-colors hover:bg-status-error/20 disabled:opacity-50"
          disabled={isApplying}
          onClick={(event) => {
            event.stopPropagation()
            void onApply()
          }}
        >
          {isApplying ? <Icon name="loader-4" className="h-3.5 w-3.5 animate-spin" /> : null}
          {t("chat.timeline.rollback.apply")}
        </button>
      </div>
    </div>
  )
}

function getFullText(parts: Part[]): string {
  return parts
    .filter((p): p is Part & { type: "text"; text: string } => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join("\n")
}

function getMessagePreview(parts: Part[]): string {
  const full = getFullText(parts)
  const singleLine = full.replace(/\n/g, " ")
  return singleLine.length > 80 ? singleLine.slice(0, 80) : singleLine
}

function getSearchSnippet(text: string, query: string, contextChars: number = 30): string | null {
  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const matchIndex = lowerText.indexOf(lowerQuery)
  if (matchIndex === -1) return null

  const start = Math.max(0, matchIndex - contextChars)
  const end = Math.min(text.length, matchIndex + query.length + contextChars)
  return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\n/g, " ")}${end < text.length ? "…" : ""}`
}
