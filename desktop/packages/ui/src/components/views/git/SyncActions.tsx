import React from "react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Icon } from "@/components/icon/Icon"
import type { GitRemote } from "@/lib/gitApi"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { SyncAction } from "./types"

interface SyncActionsProps {
  syncAction: SyncAction
  remotes: GitRemote[]
  onFetch: (remote: GitRemote) => void
  onPull: (remote: GitRemote) => void
  onPush: (remote: GitRemote) => void
  onRemoveRemote?: (remote: GitRemote) => void
  disabled: boolean
  removingRemoteName?: string | null
  aheadCount?: number
  behindCount?: number
  trackingRemoteName?: string
  hasUncommittedChanges?: boolean
}

export const SyncActions: React.FC<SyncActionsProps> = ({
  syncAction,
  remotes = [],
  onFetch,
  onPull,
  onPush,
  onRemoveRemote,
  disabled,
  removingRemoteName = null,
  aheadCount = 0,
  behindCount = 0,
  trackingRemoteName,
  hasUncommittedChanges = false,
}) => {
  const { t } = useI18n()
  const skipRemoteSelectRef = React.useRef(false)
  const isRemovingRemote = Boolean(removingRemoteName)
  const hasTrackingBranch = Boolean(trackingRemoteName)
  const trackingRemote = remotes.find((remote) => remote.name === trackingRemoteName) ?? remotes[0]
  const primaryAction: Exclude<SyncAction, "fetch" | null> =
    !hasTrackingBranch || (aheadCount > 0 && behindCount === 0) ? "push" : "pull"
  const blocksPull = primaryAction === "pull" && behindCount > 0 && hasUncommittedChanges
  const isPrimaryDisabled = disabled || syncAction !== null || isRemovingRemote || !trackingRemote || blocksPull
  const isDropdownDisabled = disabled || syncAction !== null || isRemovingRemote || remotes.length === 0
  const primaryLabel = [
    primaryAction === "push" ? t("gitView.sync.push") : t("gitView.sync.pull"),
    primaryAction === "push" && aheadCount > 0 ? `↑${aheadCount}` : null,
    primaryAction === "pull" && behindCount > 0 ? `↓${behindCount}` : null,
  ]
    .filter(Boolean)
    .join(" ")
  const tooltipLabel = blocksPull
    ? t("gitView.sync.commitOrStashTooltip")
    : trackingRemote
      ? primaryAction === "push"
        ? aheadCount > 0
          ? t("gitView.sync.pushChangesTooltip", { ahead: aheadCount })
          : t("gitView.sync.pushChanges")
        : behindCount > 0
          ? t("gitView.sync.pullChangesTooltip", { behind: behindCount })
          : t("gitView.sync.pullChanges")
      : t("gitView.sync.noRemoteTooltip")

  const handlePrimaryAction = () => {
    if (!trackingRemote) {
      return
    }
    if (primaryAction === "push") {
      onPush(trackingRemote)
    } else {
      onPull(trackingRemote)
    }
  }

  return (
    <div className="inline-flex items-center rounded-[9px] [corner-shape:squircle] supports-[corner-shape:squircle]:rounded-[50px] border border-border/60 bg-[var(--surface-elevated)] overflow-hidden">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={handlePrimaryAction}
            disabled={isPrimaryDisabled}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 px-2 typography-ui-label font-medium text-foreground",
              "transition-colors hover:bg-interactive-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50",
            )}
            aria-label={primaryAction === "push" ? t("gitView.sync.pushChanges") : t("gitView.sync.pullChanges")}
          >
            {syncAction === primaryAction ? (
              <Icon name="loader-4" className="size-4 animate-spin" />
            ) : (
              <Icon name="refresh" className="size-4" />
            )}
            <span className="whitespace-nowrap tabular-nums">{primaryLabel}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent sideOffset={8}>{tooltipLabel}</TooltipContent>
      </Tooltip>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              "inline-flex h-7 w-6 items-center justify-center border-l border-[var(--interactive-border)] text-muted-foreground",
              "transition-colors hover:bg-interactive-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50",
            )}
            disabled={isDropdownDisabled}
            aria-label={t("gitView.sync.moreActionsAria")}
          >
            <Icon name="arrow-down-s" className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          alignOffset={-40}
          className="w-[min(360px,calc(100vw-2rem))] max-h-[320px] overflow-y-auto"
        >
          {remotes.map((remote) => (
            <DropdownMenuItem
              key={remote.name}
              onSelect={(event) => {
                if (skipRemoteSelectRef.current) {
                  event.preventDefault()
                  skipRemoteSelectRef.current = false
                  return
                }
                onFetch(remote)
              }}
            >
              <div className="flex w-full items-center gap-2">
                <Icon name="refresh" className="size-4 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-col">
                    <span className="typography-ui-label text-foreground">
                      {t("gitView.sync.fetchFromRemote", { name: remote.name })}
                    </span>
                    <span className="typography-meta text-muted-foreground truncate">{remote.fetchUrl}</span>
                  </div>
                </div>
                {onRemoveRemote && remote.name !== trackingRemoteName ? (
                  <Button
                    type="button"
                    variant="destructive"
                    size="xs"
                    className="h-6 w-6 px-0"
                    disabled={syncAction !== null || isRemovingRemote}
                    onPointerDown={(event) => {
                      skipRemoteSelectRef.current = true
                      event.preventDefault()
                      event.stopPropagation()
                    }}
                    onClick={(event) => {
                      skipRemoteSelectRef.current = true
                      event.preventDefault()
                      event.stopPropagation()
                      onRemoveRemote(remote)
                    }}
                    aria-label={t("gitView.header.removeRemoteAria", { name: remote.name })}
                    title={t("gitView.header.removeRemoteTitle", { name: remote.name })}
                  >
                    {removingRemoteName === remote.name ? (
                      <Icon name="loader-4" className="size-3.5 animate-spin" />
                    ) : (
                      <Icon name="close" className="size-3.5" />
                    )}
                  </Button>
                ) : null}
              </div>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
