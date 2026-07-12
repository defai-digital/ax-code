import React from "react"
import { cn } from "@/lib/utils"

export type EmptySurfaceProps = {
  /** Quiet mark — prefer muted opacity (~0.3) on icons. */
  icon?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  /** Optional primary/secondary actions under the copy. */
  actions?: React.ReactNode
  className?: string
  contentClassName?: string
  /** Use fill height of parent (default) vs content-sized block. */
  fill?: boolean
}

/**
 * Shared empty / idle surface with intentional Ma (negative space).
 * One quiet mark, short hierarchy, optional single primary action region.
 */
export function EmptySurface({
  icon,
  title,
  description,
  actions,
  className,
  contentClassName,
  fill = true,
}: EmptySurfaceProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center w-full px-6 py-16 sm:py-20",
        fill && "min-h-full",
        className,
      )}
    >
      <div className={cn("flex flex-col items-center gap-8 max-w-sm w-full text-center", contentClassName)}>
        {icon ? <div className="shrink-0">{icon}</div> : null}
        <div className="flex flex-col items-center gap-2.5">
          <div className="typography-ui-header font-medium text-foreground tracking-tight">{title}</div>
          {description ? (
            <div className="typography-meta text-muted-foreground leading-relaxed max-w-[22rem]">{description}</div>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center justify-center gap-2">{actions}</div> : null}
      </div>
    </div>
  )
}
