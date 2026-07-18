import React from "react"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Icon } from "@/components/icon/Icon"
import { useI18n } from "@/lib/i18n"

interface ContextUsageDisplayProps {
  totalTokens: number
  percentage: number
  colorPercentage?: number
  contextLimit: number
  outputLimit?: number
  size?: "default" | "compact"
  hideIcon?: boolean
  showPercentIcon?: boolean
  className?: string
  valueClassName?: string
  percentIconClassName?: string
  onClick?: () => void
  pressed?: boolean
}

/** Compact token count for tooltips. Exported for regression tests. */
export function formatContextTokens(tokens: number): string {
  // Promote at 999_950 so 1-decimal K rounding never yields "1000.0K".
  if (tokens >= 999_950) {
    return `${(tokens / 1_000_000).toFixed(1)}M`
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`
  }
  return tokens.toFixed(1).replace(/\.0$/, "")
}

export const ContextUsageDisplay: React.FC<ContextUsageDisplayProps> = ({
  totalTokens,
  percentage,
  colorPercentage,
  contextLimit,
  outputLimit,
  size = "default",
  hideIcon = false,
  showPercentIcon = false,
  className,
  valueClassName,
  percentIconClassName,
  onClick,
  pressed = false,
}) => {
  const { t } = useI18n()
  const colorPct = typeof colorPercentage === "number" ? colorPercentage : percentage

  const getPercentageColor = (pct: number) => {
    if (pct >= 90) return "text-status-error"
    if (pct >= 75) return "text-status-warning"
    return "text-status-success"
  }

  const safeOutputLimit = typeof outputLimit === "number" ? Math.max(outputLimit, 0) : 0
  const tooltipLines = [
    t("contextUsage.tooltip.usedTokens", { tokens: formatContextTokens(totalTokens) }),
    t("contextUsage.tooltip.contextLimit", { tokens: formatContextTokens(contextLimit) }),
    t("contextUsage.tooltip.outputLimit", { tokens: formatContextTokens(safeOutputLimit) }),
  ]

  const isInteractive = typeof onClick === "function"

  const contextContent = (
    <>
      {!hideIcon && <Icon name="donut-chart" className="h-4 w-4 flex-shrink-0" />}
      <span className={cn("font-medium inline-flex items-center gap-1.5", valueClassName)}>
        {showPercentIcon ? (
          <>
            <Icon
              name="donut-chart-fill"
              className={cn("h-3.5 w-3.5", percentIconClassName, getPercentageColor(colorPct))}
              aria-hidden="true"
            />
            <span className="text-foreground">{Math.min(percentage, 999).toFixed(1)}%</span>
          </>
        ) : (
          <>
            <span className={getPercentageColor(colorPct)}>{Math.min(percentage, 999).toFixed(1)}</span>%
          </>
        )}
      </span>
    </>
  )

  const sharedClassName = cn(
    "app-region-no-drag flex items-center gap-1.5 select-none",
    size === "compact" ? "typography-micro" : "typography-meta",
    isInteractive
      ? cn(
          "rounded-md px-2 py-1.5 text-foreground transition-colors",
          "hover:bg-interactive-hover",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        )
      : "text-muted-foreground",
    className,
  )

  const contextElement = isInteractive ? (
    <button
      type="button"
      className={sharedClassName}
      aria-label={t("contextUsage.aria.label")}
      aria-pressed={pressed}
      onClick={onClick}
    >
      {contextContent}
    </button>
  ) : (
    <div className={sharedClassName} aria-label={t("contextUsage.aria.label")}>
      {contextContent}
    </div>
  )

  return (
    <Tooltip>
      <TooltipTrigger asChild>{contextElement}</TooltipTrigger>
      <TooltipContent>
        <div className="space-y-0.5">
          {tooltipLines.map((line) => (
            <p key={line} className="typography-micro leading-tight">
              {line}
            </p>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
