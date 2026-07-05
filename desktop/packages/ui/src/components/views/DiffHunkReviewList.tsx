import React from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Icon } from "@/components/icon/Icon"
import { useI18n } from "@/lib/i18n"
import { getFileHunks } from "./diffHunkRevert"

interface DiffHunkReviewListProps {
  original: string
  modified: string
  fileName?: string
  onRevertHunk: (hunkIndex: number) => void
  revertingHunkIndex: number | null
}

export const DiffHunkReviewList: React.FC<DiffHunkReviewListProps> = React.memo(
  ({ original, modified, fileName, onRevertHunk, revertingHunkIndex }) => {
    const { t } = useI18n()

    const hunks = React.useMemo(() => getFileHunks(original, modified, fileName ?? ""), [original, modified, fileName])

    if (hunks.length === 0) {
      return null
    }

    return (
      <div className="flex flex-col border-b border-border/60 bg-[var(--surface-elevated)]">
        {hunks.map((hunk, index) => {
          const isReverting = revertingHunkIndex === index
          const header = (hunk.hunkSpecs ?? "").trim()
          return (
            <div
              key={`${header}-${index}`}
              className="flex items-center gap-2 px-3 py-1 border-b border-border/40 last:border-b-0"
            >
              <span className="flex-1 min-w-0 truncate font-mono typography-micro text-muted-foreground">{header}</span>
              <span className="shrink-0 typography-micro">
                <span style={{ color: "var(--status-success)" }}>+{hunk.additionLines}</span>
                <span className="text-muted-foreground mx-0.5">/</span>
                <span style={{ color: "var(--status-error)" }}>-{hunk.deletionLines}</span>
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => onRevertHunk(index)}
                    disabled={isReverting}
                    className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label={t("diffView.hunk.revertAria", { hunk: header })}
                  >
                    {isReverting ? (
                      <Icon name="loader-4" className="size-3.5 animate-spin" />
                    ) : (
                      <Icon name="arrow-go-back" className="size-3.5" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent sideOffset={8}>{t("diffView.hunk.revertTooltip")}</TooltipContent>
              </Tooltip>
            </div>
          )
        })}
      </div>
    )
  },
)

DiffHunkReviewList.displayName = "DiffHunkReviewList"
