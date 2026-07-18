import React from "react"

import { Button } from "@/components/ui/button"
import { Icon } from "@/components/icon/Icon"
import { NumberInput } from "@/components/ui/number-input"
import { useI18n } from "@/lib/i18n"
import { DEFAULT_CORNER_RADIUS, MAX_CORNER_RADIUS, MIN_CORNER_RADIUS, normalizeCornerRadius } from "@/lib/cornerRadius"
import { useUIStore } from "@/stores/useUIStore"

export const CornerRadiusSettings: React.FC = () => {
  const { t } = useI18n()
  const cornerRadius = useUIStore((state) => state.cornerRadius)
  const setCornerRadius = useUIStore((state) => state.setCornerRadius)

  return (
    <div className="mb-8">
      <div className="mb-1 px-1">
        <h3 className="typography-ui-header font-medium text-foreground">
          {t("settings.openchamber.cornerRadius.title")}
        </h3>
      </div>

      <section className="px-2 pb-2 pt-0">
        <div className="flex flex-col gap-2 py-1.5 sm:flex-row sm:items-center sm:gap-8">
          <div className="flex min-w-0 flex-col sm:w-56 shrink-0">
            <span className="typography-ui-label text-foreground">
              {t("settings.openchamber.cornerRadius.field.radius")}
            </span>
            <span className="typography-micro text-muted-foreground">
              {t("settings.openchamber.cornerRadius.field.description")}
            </span>
          </div>
          <div className="flex items-center gap-2 sm:w-fit">
            <NumberInput
              value={cornerRadius}
              onValueChange={(value) => setCornerRadius(normalizeCornerRadius(value))}
              min={MIN_CORNER_RADIUS}
              max={MAX_CORNER_RADIUS}
              step={1}
              aria-label={t("settings.openchamber.cornerRadius.field.radiusAria")}
              className="w-20 tabular-nums"
            />
            <span className="typography-ui-label text-muted-foreground">px</span>
            <Button
              size="sm"
              type="button"
              variant="ghost"
              onClick={() => setCornerRadius(DEFAULT_CORNER_RADIUS)}
              disabled={cornerRadius === DEFAULT_CORNER_RADIUS}
              className="h-7 w-7 px-0 text-muted-foreground hover:text-foreground"
              aria-label={t("settings.openchamber.cornerRadius.actions.resetAria")}
              title={t("settings.common.actions.reset")}
            >
              <Icon name="restart" className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </section>
    </div>
  )
}
