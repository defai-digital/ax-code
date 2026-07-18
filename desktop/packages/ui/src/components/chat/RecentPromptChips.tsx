import React from "react"
import { clearRecentPrompts, listRecentPrompts } from "@/lib/recentPrompts"
import { useI18n } from "@/lib/i18n"
import { Icon } from "@/components/icon/Icon"
import { cn } from "@/lib/utils"

type RecentPromptChipsProps = {
  /** Only show when the composer is empty / draft-friendly. */
  visible?: boolean
  onSelect: (prompt: string) => void
  className?: string
}

export const RecentPromptChips: React.FC<RecentPromptChipsProps> = ({
  visible = true,
  onSelect,
  className,
}) => {
  const { t } = useI18n()
  const [prompts, setPrompts] = React.useState<string[]>(() => listRecentPrompts())

  React.useEffect(() => {
    if (!visible) return
    setPrompts(listRecentPrompts())
  }, [visible])

  if (!visible || prompts.length === 0) return null

  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-1.5 px-0.5", className)}>
      <span className="typography-micro text-muted-foreground shrink-0">{t("chat.recentPrompts.title")}</span>
      {prompts.slice(0, 5).map((prompt) => {
        const label = prompt.length > 48 ? `${prompt.slice(0, 48)}…` : prompt
        return (
          <button
            key={prompt}
            type="button"
            title={prompt}
            onClick={() => onSelect(prompt)}
            className="max-w-[14rem] truncate rounded-full border border-border/60 bg-[var(--surface-elevated)] px-2.5 py-0.5 typography-micro text-muted-foreground transition-colors hover:border-border hover:text-foreground"
          >
            {label}
          </button>
        )
      })}
      <button
        type="button"
        onClick={() => {
          clearRecentPrompts()
          setPrompts([])
        }}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:bg-interactive-hover hover:text-foreground"
        aria-label={t("chat.recentPrompts.clear")}
        title={t("chat.recentPrompts.clear")}
      >
        <Icon name="close" className="h-3 w-3" />
      </button>
    </div>
  )
}
