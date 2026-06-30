import React from "react"
import { useFeatureTour, TOUR_STEPS } from "@/hooks/useFeatureTour"
import { useI18n } from "@/lib/i18n"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { computeFeatureTourLayout } from "./featureTourLayout"

export const FeatureTour: React.FC = React.memo(function FeatureTour() {
  const { t } = useI18n()
  const { isActive, currentStep, totalSteps, currentStepData, nextStep, skip } = useFeatureTour()
  const [targetRect, setTargetRect] = React.useState<DOMRect | null>(null)

  React.useEffect(() => {
    if (!isActive || !currentStepData) return

    const el = document.querySelector(currentStepData.target)
    if (!el) return

    const updateRect = () => {
      setTargetRect(el.getBoundingClientRect())
    }

    updateRect()
    const observer = new ResizeObserver(updateRect)
    observer.observe(el)
    window.addEventListener("scroll", updateRect, true)
    window.addEventListener("resize", updateRect)

    return () => {
      observer.disconnect()
      window.removeEventListener("scroll", updateRect, true)
      window.removeEventListener("resize", updateRect)
    }
  }, [isActive, currentStepData])

  if (!isActive || !currentStepData || !targetRect) return null

  const layout = computeFeatureTourLayout({
    targetRect,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
  })

  return (
    <div className="fixed inset-0 z-[100]">
      {/* Dimmed backdrop with spotlight cutout */}
      <svg className="absolute inset-0 h-full w-full" style={{ pointerEvents: "none" }}>
        <defs>
          <mask id="tour-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            <rect
              x={layout.spotlight.left}
              y={layout.spotlight.top}
              width={layout.spotlight.width}
              height={layout.spotlight.height}
              rx="8"
              fill="black"
            />
          </mask>
        </defs>
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="rgba(0,0,0,0.6)"
          mask="url(#tour-mask)"
        />
      </svg>

      {/* Spotlight border */}
      <div
        className="absolute rounded-lg border-2 border-primary/50 shadow-[0_0_0_9999px_transparent]"
        style={{
          top: layout.spotlight.top,
          left: layout.spotlight.left,
          width: layout.spotlight.width,
          height: layout.spotlight.height,
          pointerEvents: "none",
        }}
      />

      {/* Click-through area on spotlight */}
      <div
        className="absolute cursor-pointer"
        style={{
          top: layout.spotlight.top,
          left: layout.spotlight.left,
          width: layout.spotlight.width,
          height: layout.spotlight.height,
        }}
        onClick={nextStep}
      />

      {/* Tooltip */}
      <div
        className={cn(
          "absolute z-[101] w-72 rounded-xl border border-border bg-background p-4 shadow-2xl",
          "animate-in fade-in-0 zoom-in-95 duration-200",
        )}
        style={{
          top: layout.tooltip.top,
          left: layout.tooltip.left,
          width: layout.tooltip.width,
          maxHeight: layout.tooltip.maxHeight,
          overflowY: "auto",
        }}
      >
        {/* Step indicator */}
        <div className="mb-2 flex items-center gap-1.5">
          {TOUR_STEPS.map((_, i) => (
            <div
              key={i}
              className={cn(
                "h-1.5 rounded-full transition-all",
                i === currentStep ? "w-4 bg-primary" : "w-1.5 bg-muted-foreground/30",
              )}
            />
          ))}
        </div>

        <h3 className="text-sm font-semibold text-foreground">
          {t(currentStepData.titleKey)}
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {t(currentStepData.descriptionKey)}
        </p>

        <div className="mt-3 flex items-center justify-between">
          <button
            type="button"
            onClick={skip}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {t("featureTour.skip")}
          </button>
          <Button size="sm" onClick={nextStep} className="h-7 text-xs">
            {currentStep === totalSteps - 1 ? t("featureTour.finish") : t("featureTour.next")}
          </Button>
        </div>
      </div>
    </div>
  )
})
